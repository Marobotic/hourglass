package dev.marobotic.hourglass.ui

import androidx.compose.ui.graphics.RectangleShape

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.runtime.collectAsState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.KINDS
import dev.marobotic.hourglass.core.PALETTE
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.core.ints
import dev.marobotic.hourglass.core.str
import dev.marobotic.hourglass.data.Slot
import org.json.JSONObject
import java.time.LocalDate

@Composable
fun SheetHost(nav: Nav, version: Int) {
    val s = nav.sheets
    s.event?.let { (ev, defaults) -> EventSheet(nav, ev, defaults) { s.event = null } }
    s.course?.let { (_, c) -> CourseSheet(nav, c) { s.course = null } }
    s.session?.let { SessionSheet(nav, it, version) { s.session = null } }
    if (s.alarm) AlarmSheet(nav) { s.alarm = false }
    if (s.settings) SettingsSheet(nav) { s.settings = false }
    s.confirm?.let { (title, msg, action) ->
        AlertDialog(
            onDismissRequest = { s.confirm = null }, containerColor = HColors.surface,
            title = { T(title, 18, bold = true) }, text = { T(msg, 14, HColors.muted) },
            confirmButton = { TextButton({ s.confirm = null; action() }) { T("Confirm", 14, HColors.accent, bold = true) } },
            dismissButton = { TextButton({ s.confirm = null }) { T("Cancel", 14, HColors.muted) } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Sheet(title: String, onDismiss: () -> Unit, subtitle: String? = null, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = HColors.surface, dragHandle = null) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    T(title, 20, bold = true)
                    if (subtitle != null) T(subtitle, 12, HColors.muted)
                }
                IconButton(onDismiss) { Icon(Icons.Outlined.Close, "Close", tint = HColors.muted) }
            }
            content()
        }
    }
}

@Composable
private fun <T> Segmented(options: List<Pair<String, T>>, value: T, onChange: (T) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((label, v) in options) {
            val on = v == value
            Box(Modifier.clip(RectangleShape).background(if (on) HColors.surface2 else Color.Transparent)
                .border(1.dp, if (on) HColors.faint else HColors.border, RectangleShape).clickable { onChange(v) }.padding(horizontal = 12.dp, vertical = 8.dp)) {
                T(label, 13, if (on) HColors.fg else HColors.muted)
            }
        }
    }
}

// ------------------------------------------------------------------ event

@Composable
private fun EventSheet(nav: Nav, ev: JSONObject?, defaults: Map<String, Any?>, onDismiss: () -> Unit) {
    val repo = nav.repo
    val today = LocalDate.now(repo.zone).toString()
    var courseId by remember { mutableStateOf(ev?.str("course_id") ?: defaults["course"] as String?) }
    var kind by remember { mutableStateOf(ev?.optString("kind") ?: if (courseId != null) "lecture" else "event") }
    var title by remember { mutableStateOf(ev?.optString("title") ?: "") }
    var date by remember { mutableStateOf(ev?.optString("start_date") ?: defaults["date"] as String? ?: today) }
    var start by remember { mutableStateOf(ev?.optString("start_time") ?: "09:00") }
    var end by remember { mutableStateOf(ev?.optString("end_time") ?: "10:00") }
    var room by remember { mutableStateOf(ev?.str("location") ?: "") }
    val rep = ev?.optJSONObject("repeat")
    var repeat by remember { mutableStateOf(rep?.optString("freq") ?: if (defaults["weekly"] == true) "weekly" else "none") }
    var days by remember { mutableStateOf(rep?.ints("days")?.ifEmpty { null } ?: listOf(Dates.iso(LocalDate.parse(date)))) }
    var until by remember { mutableStateOf(rep?.str("until")) }
    val valid = Dates.minutes(end) > Dates.minutes(start) && (title.isNotBlank() || courseId != null) && (repeat != "weekly" || days.isNotEmpty())

    Sheet(if (ev == null) "New event" else "Edit event", onDismiss, if (ev?.optJSONObject("repeat") != null) "Changes apply to every session of this series." else null) {
        T("COURSE", 11, HColors.muted, spacing = 0.6)
        Segmented(listOf("None" to null as String?) + repo.courses().map { it.optString("name") to it.id }, courseId) { courseId = it; if (it != null && kind == "event") kind = "lecture" }
        T("KIND", 11, HColors.muted, spacing = 0.6)
        Segmented(KINDS.map { kindLabel(it) to it }, kind) { kind = it }
        Field(title, { title = it }, if (courseId != null) "Title (optional)" else "Title", Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            DateField(date, { if (it != null) date = it }, if (repeat == "none") "DATE" else "FIRST DATE", Modifier.weight(1.3f))
            TimeField(start, { start = it; if (Dates.minutes(end) <= Dates.minutes(it)) end = Dates.pad((Dates.minutes(it) / 60 + 1).coerceAtMost(23)) + ":" + it.takeLast(2) }, "START", Modifier.weight(1f))
            TimeField(end, { end = it }, "END", Modifier.weight(1f))
        }
        Field(room, { room = it }, "Room (optional)", Modifier.fillMaxWidth())
        T("REPEAT", 11, HColors.muted, spacing = 0.6)
        Segmented(listOf("Once" to "none", "Weekly" to "weekly", "Daily" to "daily"), repeat) { repeat = it }
        if (repeat == "weekly") DayToggles(days) { days = it }
        if (repeat != "none") DateField(until, { until = it }, "UNTIL (END OF TERM)", Modifier.fillMaxWidth(), clearable = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (ev != null) HButton(if (rep != null) "Delete series" else "Delete", danger = true) {
                nav.sheets.confirm = Triple(if (rep != null) "Delete every session?" else "Delete event?",
                    if (rep != null) "This removes the whole series. To skip one date, open that session and choose Skip." else "This event will be removed from every device.") { repo.removeEvent(ev.id); onDismiss() }
            }
            Spacer(Modifier.weight(1f))
            HButton(if (ev == null) "Add event" else "Save", primary = true, enabled = valid) {
                val r = when (repeat) {
                    "weekly" -> repo.weekly(days, until)
                    "daily" -> JSONObject().put("freq", "daily").apply { until?.let { put("until", it) } }
                    else -> null
                }
                if (ev == null) repo.addEvent(courseId, title.trim(), kind, date, start, end, room.trim().ifBlank { null }, r)
                else repo.updateEvent(ev.id, mapOf("course_id" to courseId, "title" to title.trim(), "kind" to kind, "start_date" to date,
                    "start_time" to start, "end_time" to end, "location" to room.trim().ifBlank { null }, "repeat" to r))
                onDismiss()
            }
        }
    }
}

// ------------------------------------------------------------------ course

@Composable
private fun CourseSheet(nav: Nav, c: JSONObject?, onDismiss: () -> Unit) {
    val repo = nav.repo
    var name by remember { mutableStateOf(c?.optString("name") ?: "") }
    var code by remember { mutableStateOf(c?.str("code") ?: "") }
    var room by remember { mutableStateOf(c?.str("location") ?: "") }
    var teacher by remember { mutableStateOf(c?.str("teacher") ?: "") }
    val used = remember { repo.courses().map { it.optString("color") } }
    var color by remember { mutableStateOf(c?.optString("color") ?: PALETTE.firstOrNull { it !in used } ?: PALETTE[0]) }
    var slots by remember { mutableStateOf(if (c == null) listOf(Slot(2, "09:00", "11:00")) else emptyList()) }
    var termEnd by remember { mutableStateOf<String?>(null) }
    val valid = name.isNotBlank() && slots.all { Dates.minutes(it.end) > Dates.minutes(it.start) }

    Sheet(if (c == null) "New course" else "Edit course", onDismiss, if (c == null) "Add its weekly times now; you can change them later." else null) {
        Field(name, { name = it }, "Name", Modifier.fillMaxWidth(), placeholder = "e.g. Algorithms")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Field(code, { code = it }, "Code", Modifier.weight(1f))
            Field(room, { room = it }, "Room", Modifier.weight(1f))
        }
        Field(teacher, { teacher = it }, "Lecturer", Modifier.fillMaxWidth())
        T("COLOUR", 11, HColors.muted, spacing = 0.6)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (p in PALETTE) Box(Modifier.size(32.dp).clip(RectangleShape).background(hex(p))
                .border(2.dp, if (p == color) HColors.fg else Color.Transparent, RectangleShape).clickable { color = p })
        }
        if (c == null) {
            T("WEEKLY TIMES", 11, HColors.muted, spacing = 0.6)
            for ((i, s) in slots.withIndex()) {
                HCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Segmented(Dates.WEEKDAYS.mapIndexed { d, w -> w to d + 1 }, s.day) { v -> slots = slots.toMutableList().also { it[i] = s.copy(day = v) } }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                        TimeField(s.start, { v -> slots = slots.toMutableList().also { it[i] = s.copy(start = v) } }, "START", Modifier.weight(1f))
                        TimeField(s.end, { v -> slots = slots.toMutableList().also { it[i] = s.copy(end = v) } }, "END", Modifier.weight(1f))
                        IconButton({ slots = slots.toMutableList().also { it.removeAt(i) } }) { Icon(Icons.Outlined.Close, "Remove", tint = HColors.muted) }
                    }
                    Spacer(Modifier.height(8.dp))
                    Segmented(KINDS.take(4).map { kindLabel(it) to it }, s.kind) { v -> slots = slots.toMutableList().also { it[i] = s.copy(kind = v) } }
                }
            }
            HButton("Add a time") { slots = slots + Slot(4, "14:00", "15:00", "lab") }
            DateField(termEnd, { termEnd = it }, "TERM ENDS", Modifier.fillMaxWidth(), clearable = true)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (c != null) HButton("Delete course", danger = true) {
                nav.sheets.confirm = Triple("Delete ${c.optString("name")}?", "Its sessions are removed from the calendar. Notes are kept.") { repo.removeCourse(c.id); onDismiss(); nav.pop() }
            }
            Spacer(Modifier.weight(1f))
            HButton(if (c == null) "Add course" else "Save", primary = true, enabled = valid) {
                val f = mapOf("name" to name.trim(), "code" to code.trim().ifBlank { null }, "location" to room.trim().ifBlank { null }, "teacher" to teacher.trim().ifBlank { null }, "color" to color)
                if (c == null) repo.addCourse(name.trim(), f["code"] as String?, color, f["location"] as String?, f["teacher"] as String?, slots, termEnd)
                else repo.updateCourse(c.id, f)
                onDismiss()
            }
        }
    }
}

// ------------------------------------------------------------------ session

@Composable
private fun SessionSheet(nav: Nav, o: dev.marobotic.hourglass.core.Occ, version: Int, onDismiss: () -> Unit) {
    val repo = nav.repo
    val notes = remember(version) { o.courseId?.let { cid -> repo.notesFor(cid).filter { it.str("session_date") == o.date.toString() } } ?: emptyList() }
    Sheet(o.title, onDismiss, "${Dates.long(o.date)}  ·  ${o.startTime}–${o.endTime}" + (o.location?.let { "  ·  $it" } ?: "")) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(kindLabel(o.kind), hex(o.color))
            o.courseCode?.let { Chip(it, HColors.muted) }
        }
        if (o.courseId != null) {
            Section("Notes for this session")
            if (notes.isEmpty()) T("None yet.", 12, HColors.faint)
            for (n in notes) NoteRow(n) { onDismiss(); nav.openNote(n) }
            HButton(if (notes.isEmpty()) "Start a note for this session" else "Add another note", Modifier.fillMaxWidth(), primary = true, icon = Icons.Outlined.EditNote) {
                onDismiss()
                nav.openNote(repo.addNote(o.courseId, o.date, o.eventId, Dates.short(o.date) + if (notes.isNotEmpty()) " (${notes.size + 1})" else ""))
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HButton("Skip this date", danger = true) {
                nav.sheets.confirm = Triple("Skip ${Dates.short(o.date)}?", "Only this session is removed. The rest of the series stays.") { repo.skipOccurrence(o.eventId, o.date); onDismiss() }
            }
            Spacer(Modifier.weight(1f))
            HButton("Edit event") { repo.store.get("events", o.eventId)?.let { onDismiss(); nav.sheets.event = it to emptyMap() } }
        }
    }
}

// ------------------------------------------------------------------ alarm

@Composable
private fun AlarmSheet(nav: Nav, onDismiss: () -> Unit) {
    val repo = nav.repo
    val courses = remember { repo.courses() }
    var mode by remember { mutableStateOf("time") }
    var time by remember { mutableStateOf("07:30") }
    var days by remember { mutableStateOf(listOf(1, 2, 3, 4, 5)) }
    var label by remember { mutableStateOf("") }
    var course by remember { mutableStateOf(courses.firstOrNull()?.id) }
    var lead by remember { mutableStateOf("15") }
    Sheet("New alarm", onDismiss) {
        Segmented(listOf("At a time" to "time", "Before a course" to "before"), mode) { if (it == "time" || courses.isNotEmpty()) mode = it }
        if (mode == "time") {
            TimeField(time, { time = it }, "TIME", Modifier.fillMaxWidth())
            DayToggles(days) { days = it }
            T(if (days.isEmpty()) "No days selected: rings once, at the next matching time." else "Repeats on the highlighted days.", 12, HColors.faint)
            Field(label, { label = it }, "Label", Modifier.fillMaxWidth())
        } else {
            Field(lead, { lead = it.filter { ch -> ch.isDigit() }.take(3) }, "Minutes before", Modifier.fillMaxWidth())
            T("COURSE", 11, HColors.muted, spacing = 0.6)
            Segmented(courses.map { it.optString("name") to it.id as String? }, course) { course = it }
        }
        HButton("Add alarm", Modifier.fillMaxWidth(), primary = true, enabled = mode == "time" || (course != null && lead.isNotEmpty())) {
            if (mode == "time") {
                var date: String? = null
                if (days.isEmpty()) {
                    val now = java.time.LocalDateTime.now(repo.zone)
                    val t = now.toLocalDate().atTime(Dates.time(time))
                    date = (if (t.isAfter(now)) t else t.plusDays(1)).toLocalDate().toString()
                }
                repo.addAlarm(label, time, days, date, null, null)
            } else repo.addAlarm("", null, emptyList(), null, course, lead.toInt())
            onDismiss()
        }
    }
}

// ------------------------------------------------------------------ settings

// Preferences. The account is the Omarchy Music one; ringtones and the
// chosen one sync to every device.
@Composable
private fun SettingsSheet(nav: Nav, onDismiss: () -> Unit) {
    val repo = nav.repo
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var tick by remember { mutableStateOf(0) }
    val version by repo.store.version.collectAsState()
    val sync by repo.sync.collectAsState()
    fun set(k: String, v: String) { repo.setPref(k, v); tick++ }
    var email by remember { mutableStateOf(repo.account ?: "") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val pick = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val name = ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (i >= 0 && c.moveToFirst()) c.getString(i) else null
        } ?: "My ringtone"
        val bytes = runCatching { ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
        if (bytes == null) { error = "Could not read that file"; return@rememberLauncherForActivityResult }
        busy = true
        error = null
        repo.uploadRingtone(bytes, name) { busy = false; error = it; tick++ }
    }
    androidx.compose.runtime.DisposableEffect(Unit) { onDispose { dev.marobotic.hourglass.alarm.Preview.stop() } }
    key(tick, version, sync) {
        Sheet("Settings", onDismiss) {
            Section("Account")
            if (repo.signedIn) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        T(repo.account ?: "", 15)
                        T(when (sync.state) {
                            "synced" -> "Omarchy Music account · synced ${Dates.clock(sync.lastOk, repo.zone)}"
                            "offline" -> "Offline. Changes are kept on the phone and sent later."
                            else -> "Omarchy Music account"
                        }, 12, HColors.muted)
                    }
                    HButton("Sign out") { nav.sheets.confirm = Triple("Sign out?", "This phone stops syncing until you sign in again.") { repo.signOut(); tick++ } }
                }
            }
            error?.let { T(it, 13, HColors.accent) }

            Section("Alarms")
            T("LECTURE REMINDERS", 11, HColors.muted, spacing = 0.6)
            Segmented(listOf("Off" to 0, "10 min" to 10, "15 min" to 15, "30 min" to 30, "60 min" to 60), repo.reminderMin) { repo.setLectureReminders(it); tick++ }
            T("Rings before every lecture, on all your devices, even with the app closed.", 12, HColors.faint)
            Row(verticalAlignment = Alignment.CenterVertically) {
                T("RINGTONE", 11, HColors.muted, spacing = 0.6, modifier = Modifier.weight(1f))
                HButton(if (busy) "Uploading…" else "Upload", enabled = !busy && token(repo)) { pick.launch("audio/*") }
            }
            val current = repo.ringtone
            val rows = dev.marobotic.hourglass.data.BUILTIN_RINGTONES.map { Triple(it, it.replaceFirstChar { c -> c.uppercase() }, "Built in") } +
                repo.ringtones().map { r -> Triple(r.id, r.optString("name"), if (r.optString("kind") == "song") "Song" + (r.str("artist")?.let { " · $it" } ?: "") else "Upload") }
            Column {
                for ((id, name, sub) in rows) {
                    val on = id == current
                    val custom = sub != "Built in"
                    Row(
                        Modifier.fillMaxWidth().background(if (on) HColors.surface2 else Color.Transparent).clickable { repo.setRingtone(id); tick++ }.padding(start = 12.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(14.dp).background(if (on) HColors.accent else Color.Transparent).border(1.dp, if (on) HColors.accent else HColors.faint))
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            T(name, 15, bold = on, maxLines = 1)
                            T(sub + if (custom && !repo.soundFile(id).exists()) " · downloading" else "", 12, HColors.muted, maxLines = 1)
                        }
                        IconButton({ dev.marobotic.hourglass.alarm.Preview.toggle(ctx, id); tick++ }) {
                            Icon(if (dev.marobotic.hourglass.alarm.Preview.playing == id) Icons.Outlined.Stop else Icons.Outlined.PlayArrow, "Play", tint = HColors.muted)
                        }
                        if (custom) IconButton({ nav.sheets.confirm = Triple("Delete $name?", "It is removed from every device." + if (on) " Alarms go back to Classic." else "") { repo.removeRingtone(id); tick++ } }) {
                            Icon(Icons.Outlined.Delete, "Delete", tint = HColors.muted)
                        }
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(HColors.border))
                }
            }
            T("Add songs from Omarchy Music: open a song's menu and pick Set as alarm.", 12, HColors.faint)
            Row(verticalAlignment = Alignment.CenterVertically) { T("Alarm sound", 15, modifier = Modifier.weight(1f)); Toggle(repo.sound) { set("sound", it.toString()) } }
            Row(verticalAlignment = Alignment.CenterVertically) { T("Vibrate", 15, modifier = Modifier.weight(1f)); Toggle(repo.vibrate) { set("vibrate", it.toString()) } }

            Section("Time")
            T("CLOCK", 11, HColors.muted, spacing = 0.6)
            Segmented(listOf("12-hour" to false, "24-hour" to true), repo.h24) { set("time_format", if (it) "24h" else "12h") }
            T("WEEK STARTS ON", 11, HColors.muted, spacing = 0.6)
            Segmented(listOf("Saturday" to 6, "Sunday" to 7, "Monday" to 1), repo.firstDay) { set("week_start", it.toString()) }
            if (repo.signedIn || sync.state == "synced") Row(verticalAlignment = Alignment.CenterVertically) {
                T(if (sync.state == "offline") "Offline" else "Synced with marobotic.dev", 13, HColors.muted, modifier = Modifier.weight(1f))
                HButton("Sync now") { repo.syncNow() }
            }
        }
    }
}

private fun token(repo: dev.marobotic.hourglass.data.Repo) = repo.signedIn || repo.sync.value.state == "synced"
