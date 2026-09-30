package dev.marobotic.hourglass.ui

import androidx.compose.ui.graphics.RectangleShape

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.StickyNote2
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.Occ
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.core.ints
import dev.marobotic.hourglass.core.str
import org.json.JSONObject
import java.time.LocalDate

fun kindLabel(k: String) = k.replaceFirstChar { it.uppercase() }

@Composable
fun NoteRow(n: JSONObject, course: JSONObject? = null, onClick: () -> Unit) {
    HCard(Modifier.fillMaxWidth(), onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(if (n.optInt("pinned") == 1) Icons.Outlined.PushPin else Icons.Outlined.StickyNote2, null,
                tint = if (n.optInt("pinned") == 1) HColors.gold else HColors.muted, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(8.dp))
            T(n.optString("title").ifBlank { "Untitled" }, 15, bold = true, maxLines = 1, modifier = Modifier.weight(1f))
            if (course != null) T(course.str("code") ?: course.optString("name"), 12, hex(course.optString("color")), maxLines = 1)
        }
        val preview = n.optString("body").replace(Regex("[#>*_`\\[\\]-]"), "").replace(Regex("\\s+"), " ").trim()
        if (preview.isNotEmpty()) { Spacer(Modifier.height(4.dp)); T(preview, 13, HColors.muted, maxLines = 2) }
    }
}

// ------------------------------------------------------------------ Now

// An overview, not a dashboard: the one thing on or next, the few after it,
// and one line for the next alarm and any running timer.
@Composable
fun NowScreen(nav: Nav, version: Int, clock: Long) {
    val repo = nav.repo
    val zone = repo.zone
    val today = remember(clock / 60_000) { java.time.LocalDate.now(zone) }
    val blocks = remember(version, today) { dev.marobotic.hourglass.core.merge(repo.occurrences(today, today.plusDays(7))) }
    val current = blocks.firstOrNull { it.endMs > clock }
    // Notes dated today, then the class's: this session's, else the last one's.
    val todayNotes = remember(version, today, current?.first?.courseId, current?.first?.date) {
        val all = repo.notes()
        val out = all.filter { it.str("session_date") == today.toString() }.toMutableList()
        current?.first?.courseId?.let { cid ->
            val mine = all.filter { it.str("course_id") == cid && (it.str("session_date") ?: "~") <= current.first.date.toString() }
            val last = mine.maxOfOrNull { it.optString("session_date") }
            mine.filter { it.optString("session_date") == last && it !in out }.forEach { out.add(it) }
        }
        out.sortedWith(compareByDescending<JSONObject> { it.optInt("pinned") }.thenByDescending { it.optLong("updated_at") }).take(6)
    }
    val alarm = remember(version, clock / 60_000) {
        val cs = repo.store.all("courses"); val es = repo.events()
        repo.alarms().mapNotNull { a -> dev.marobotic.hourglass.core.Alarms.next(a, cs, es, clock, zone)?.let { a to it } }.minByOrNull { it.second }
    }
    val timer = remember(version) { repo.timers().firstOrNull() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
        item {
            Column {
                T(Dates.long(today), 14, HColors.muted)
                T(Dates.clock(clock, zone), 42, bold = true)
            }
        }
        item {
            val live = current != null && clock >= current.startMs
            HCard(Modifier.fillMaxWidth(), stripe = current?.let { hex(it.first.color) } ?: HColors.border) {
                T(when { current == null -> "NOTHING SCHEDULED"; live -> "NOW"; current.first.date == today -> "NEXT"; else -> "NEXT · " + Dates.short(current.first.date).uppercase() },
                    12, if (live) HColors.accent else HColors.muted, bold = true, spacing = 2.0)
                Spacer(Modifier.height(8.dp))
                T(current?.first?.title ?: "Your week is clear.", 26, bold = true)
                if (current != null) {
                    Spacer(Modifier.height(6.dp))
                    T(Dates.range(current.startTime, current.endTime) + (current.first.location?.let { "   $it" } ?: ""), 18, bold = true)
                    current.first.teacher?.let { T(it.substringBefore(","), 14, HColors.muted) }
                    Spacer(Modifier.height(4.dp))
                    T(if (live) Dates.left((current.endMs - clock + 59_999) / 60_000) else "Starts " + Dates.relative((current.startMs - clock + 59_999) / 60_000), 14, if (live) HColors.accent else HColors.muted)
                    if (current.first.courseId != null) {
                        Spacer(Modifier.height(12.dp))
                        HButton("Notes for this class", primary = true, icon = Icons.Outlined.EditNote) {
                            val existing = if (live) repo.now(clock).notes.session else emptyList()
                            nav.sessionNote(current.first, existing)
                        }
                    }
                } else if (repo.courses().isEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    HButton("Add a course", primary = true, icon = Icons.Outlined.Add) { nav.sheets.course = true to null }
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                T("NOTES FOR TODAY", 12, HColors.muted, bold = true, spacing = 2.0)
                if (todayNotes.isEmpty()) T("Nothing yet. Notes you take in class show up here.", 13, HColors.faint)
                for (pair in todayNotes.chunked(2)) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (n in pair) {
                        val c = repo.course(n.str("course_id"))
                        val tint = c?.let { hex(it.optString("color")) }
                        Column(
                            Modifier.weight(1f).background(tint?.copy(alpha = 0.14f) ?: HColors.surface).border(1.dp, tint?.copy(alpha = 0.45f) ?: HColors.border).clickable { nav.openNote(n) }.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            if (n.optString("title").isNotBlank()) T(n.optString("title"), 14, bold = true, maxLines = 1)
                            if (n.optString("body").isNotBlank()) T(n.optString("body"), 13, HColors.fg.copy(alpha = 0.85f), maxLines = 4)
                            T(listOfNotNull(c?.let { it.str("code") ?: it.optString("name") }, if (n.str("session_date") == today.toString()) "Today" else n.str("session_date")?.let { "Last class · " + Dates.short(java.time.LocalDate.parse(it)) }).joinToString("  ·  "), 11, tint ?: HColors.muted, bold = true, maxLines = 1)
                        }
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        if (alarm != null || timer != null) item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                alarm?.let { (a, at) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Alarm, null, tint = HColors.muted, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(8.dp))
                        T(Dates.clock(at, zone) + if (Dates.local(at, zone).toLocalDate() != today) " " + Dates.WEEKDAYS[Dates.iso(Dates.local(at, zone).toLocalDate()) - 1] else "", 14, bold = true)
                        Spacer(Modifier.width(8.dp)); T(a.optString("label"), 13, HColors.muted, maxLines = 1)
                    }
                }
                timer?.let { t ->
                    val remain = if (t.optString("state") == "running") (t.optLong("ends_at") - clock + 999) / 1000 else t.optLong("remaining_s")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Pause, null, tint = HColors.accent, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(8.dp))
                        T(Dates.countdown(remain) + "  " + t.optString("label"), 14)
                    }
                }
            }
        }
    }
}

@Composable
private fun Hero(nav: Nav, f: Occ, session: List<JSONObject>, clock: Long) {
    val state = f.state(clock)
    val live = state == "live"
    val color = hex(f.color)
    val pulse by rememberInfiniteTransition(label = "p").animateFloat(1f, 0.25f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "a")
    HCard(Modifier.fillMaxWidth(), stripe = color) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (live) { Box(Modifier.size(8.dp).alpha(pulse).clip(RectangleShape).background(HColors.accent)); Spacer(Modifier.width(8.dp)) }
            T(when (state) { "live" -> "LIVE NOW"; "ended" -> "JUST ENDED"; else -> "UP NEXT" }, 11, if (live) HColors.accent else HColors.muted, bold = true, spacing = 1.6)
            Spacer(Modifier.width(8.dp))
            Chip(kindLabel(f.kind), color)
            Grow()
            T(Dates.range(f.startTime, f.endTime), 14, HColors.muted)
        }
        Spacer(Modifier.height(8.dp))
        T(f.title, 28, bold = true)
        if (f.location != null || f.courseCode != null) {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (f.location != null) { Icon(Icons.Outlined.Place, null, tint = HColors.muted, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)); T(f.location, 13, HColors.muted); Spacer(Modifier.width(14.dp)) }
                if (f.courseCode != null) T(f.courseCode, 13, HColors.faint)
            }
        }
        if (f.teacher != null) {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.Top) {
                Icon(Icons.Outlined.Person, null, tint = HColors.muted, modifier = Modifier.size(14.dp).padding(top = 2.dp)); Spacer(Modifier.width(4.dp))
                T(f.teacher, 13, HColors.muted)
            }
        }
        Spacer(Modifier.height(12.dp))
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RectangleShape).background(HColors.surface2)) {
            Box(Modifier.fillMaxWidth(if (live) f.progress(clock) else 0f).fillMaxHeight().clip(RectangleShape).background(color))
        }
        Spacer(Modifier.height(6.dp))
        T(when (state) {
            "live" -> Dates.left((f.endMs - clock + 59_999) / 60_000)
            "ended" -> "Ended ${Dates.t(f.endTime)}. Good time to tidy your notes."
            else -> "Starts " + Dates.relative((f.startMs - clock + 59_999) / 60_000)
        }, 12, HColors.muted)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HButton(if (session.isNotEmpty()) "Open today's note" else "Start today's note", Modifier.weight(1f), primary = true, icon = Icons.Outlined.EditNote) { nav.sessionNote(f, session) }
            HButton("", icon = Icons.Outlined.FolderOpen) { nav.sheets.session = f }
        }
    }
}

@Composable
fun TimelineRow(o: Occ, clock: Long, onClick: () -> Unit) {
    val past = clock >= o.endMs
    val live = clock >= o.startMs && !past
    val color = hex(o.color)
    Row(
        Modifier.fillMaxWidth().clip(RectangleShape).background(if (live) color.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 10.dp).alpha(if (past) 0.5f else 1f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.width(52.dp)) { T(o.startTime, 14, bold = true); T(o.endTime, 11, HColors.faint) }
        Box(Modifier.width(3.dp).height(34.dp).clip(RectangleShape).background(color))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            T(o.title, 14, maxLines = 1)
            T(listOfNotNull(o.location?.substringBefore(" · "), kindLabel(o.kind), o.courseCode).joinToString(" · "), 12, HColors.muted, maxLines = 1)
        }
        if (live) Box(Modifier.size(8.dp).clip(RectangleShape).background(HColors.accent))
    }
}

@Composable
fun TimerCard(nav: Nav, t: JSONObject, clock: Long, big: Boolean = false) {
    val running = t.optString("state") == "running"
    val remain = if (running) (t.optLong("ends_at") - clock + 999) / 1000 else t.optLong("remaining_s")
    HCard(Modifier.fillMaxWidth(), stripe = if (big) (if (running) HColors.accent else HColors.faint) else null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                T(Dates.countdown(remain), if (big) 34 else 22, if (running) HColors.fg else HColors.muted, bold = true)
                T(t.optString("label") + if (!running) "  ·  paused" else "", 12, HColors.muted, maxLines = 1)
            }
            IconButton({ if (running) nav.repo.pauseTimer(t) else nav.repo.resumeTimer(t) }) {
                Icon(if (running) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, null, tint = HColors.fg)
            }
            IconButton({ nav.repo.stopTimer(t.id) }) { Icon(Icons.Outlined.Close, null, tint = HColors.muted) }
        }
        if (big) {
            val frac = (remain.toFloat() / maxOf(1, t.optInt("duration_s"))).coerceIn(0f, 1f)
            Spacer(Modifier.height(8.dp))
            Box(Modifier.fillMaxWidth().height(4.dp).clip(RectangleShape).background(HColors.surface2)) {
                Box(Modifier.fillMaxWidth(frac).fillMaxHeight().background(HColors.accent))
            }
        }
    }
}

fun repeatText(e: JSONObject): String {
    val r = e.optJSONObject("repeat") ?: return "Once, " + Dates.short(e.optString("start_date"))
    var s = if (r.optString("freq") == "daily") "Daily"
    else "Every " + r.ints("days").ifEmpty { listOf(Dates.iso(Dates.date(e.optString("start_date")))) }.joinToString(", ") { Dates.WEEKDAYS[it - 1] }
    r.str("until")?.let { s += " until " + Dates.short(it) }
    return s
}

// ------------------------------------------------------------------ Time

@Composable
fun TimeScreen(nav: Nav, version: Int, clock: Long) {
    val repo = nav.repo
    val timers = remember(version) { repo.timers() }
    val alarms = remember(version, clock / 60_000) {
        val courses = repo.store.all("courses"); val events = repo.events()
        repo.alarms().map { it to dev.marobotic.hourglass.core.Alarms.next(it, courses, events, clock, repo.zone) }.sortedBy { it.second ?: Long.MAX_VALUE }
    }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { T("Timers", 24, bold = true) }
            item {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (m in listOf(1, 5, 10, 15, 25, 45, 50, 90)) HButton("$m min") { repo.startTimer(m * 60, "") }
                }
            }
            items(timers, key = { it.id }) { TimerCard(nav, it, clock, big = true) }
            item { Spacer(Modifier.height(8.dp)); T("Alarms", 24, bold = true) }
            if (alarms.isEmpty()) item { T("No alarms yet. Tap + to add one, at a time or before a course.", 13, HColors.muted) }
            items(alarms, key = { it.first.id }) { (a, next) ->
                val on = a.optInt("enabled") == 1
                HCard(Modifier.fillMaxWidth().alpha(if (on) 1f else 0.55f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        T(a.str("time")?.let { Dates.t(it) } ?: next?.let { Dates.clock(it, repo.zone) } ?: "—", 26, bold = true, modifier = Modifier.weight(1f))
                        Toggle(on) { repo.setAlarmEnabled(a.id, it) }
                        IconButton({ repo.removeAlarm(a.id) }) { Icon(Icons.Outlined.Delete, "Delete", tint = HColors.muted) }
                    }
                    T(a.optString("label"), 14, maxLines = 2)
                    val days = a.ints("days")
                    val sub = when {
                        a.str("lead_course_id") != null || a.str("lead_event_id") != null -> "Rings ${a.optInt("lead_minutes")} min before the lecture"
                        a.str("date") != null -> "Once, " + Dates.short(a.optString("date"))
                        days.isEmpty() -> "Every day"
                        days == listOf(1, 2, 3, 4, 5) -> "Weekdays"
                        else -> days.joinToString(", ") { Dates.WEEKDAYS[it - 1] }
                    }
                    T(sub + (next?.let { "  ·  next " + Dates.short(Dates.local(it, repo.zone).toLocalDate()) } ?: ""), 12, HColors.muted, maxLines = 1)
                }
            }
            item { Spacer(Modifier.height(72.dp)) }
        }
        FloatingActionButton({ nav.sheets.alarm = true }, Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = HColors.accent, shape = RectangleShape) {
            Icon(Icons.Outlined.Alarm, "Add alarm", tint = Color.White)
        }
    }
}

// World clock tab: cities, and which one is the app's time zone (synced).
@Composable
fun ClockScreen(nav: Nav, version: Int, clock: Long) {
    val repo = nav.repo
    val clocks = remember(version) { repo.clocks() }
    var query by rememberSaveable { mutableStateOf("") }
    val now = java.time.Instant.ofEpochMilli(clock)
    val home = repo.zone
    val homeDate = now.atZone(home).toLocalDate()
    val homeOff = home.rules.getOffset(now).totalSeconds / 60
    LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Column {
                T("World clock", 24, bold = true)
                T("Hourglass runs on ${home.id.substringAfterLast('/').replace('_', ' ')} time", 13, HColors.muted)
            }
        }
        item { Field(query, { query = it }, "Add a city, e.g. Tokyo", Modifier.fillMaxWidth()) }
        val q = query.trim().lowercase().replace(' ', '_')
        if (q.isNotEmpty()) {
            val hits = java.time.ZoneId.getAvailableZoneIds().filter { it.contains('/') && it.lowercase().contains(q) }.sorted().take(8)
            items(hits, key = { "z$it" }) { z ->
                val t = now.atZone(java.time.ZoneId.of(z))
                Row(Modifier.fillMaxWidth().clickable { repo.addClock(z); query = "" }.padding(vertical = 10.dp)) {
                    T(z.substringAfterLast('/').replace('_', ' '), 15, modifier = Modifier.weight(1f))
                    T(Dates.t("%02d:%02d".format(t.hour, t.minute)), 15, HColors.muted)
                }
            }
        }
        items(clocks, key = { it.optString("id") }) { c ->
            val z = runCatching { java.time.ZoneId.of(c.optString("zone")) }.getOrNull() ?: return@items
            val t = now.atZone(z)
            val isHome = z.id == home.id
            val diff = z.rules.getOffset(now).totalSeconds / 60 - homeOff
            val day = when { t.toLocalDate() == homeDate -> "Today"; t.toLocalDate().isAfter(homeDate) -> "Tomorrow"; else -> "Yesterday" }
            HCard(Modifier.fillMaxWidth(), stripe = if (isHome) HColors.accent else null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    T(c.optString("label"), 16, bold = true, modifier = Modifier.weight(1f))
                    if (isHome) Chip("App time", HColors.accent) else IconButton({ repo.removeClock(c.optString("id")) }) { Icon(Icons.Outlined.Close, "Remove", tint = HColors.faint) }
                }
                T(Dates.t("%02d:%02d".format(t.hour, t.minute)), 34, bold = true)
                T(day + if (isHome) "" else "  ·  " + (if (diff == 0) "same time" else (if (diff > 0) "+" else "−") + "${kotlin.math.abs(diff) / 60}" + (if (kotlin.math.abs(diff) % 60 != 0) ":%02d".format(kotlin.math.abs(diff) % 60) else "") + " h"), 14, HColors.muted)
                if (!isHome) {
                    Spacer(Modifier.height(8.dp))
                    HButton("Use as app time") { repo.setHomeClock(c.optString("id")) }
                }
            }
        }
    }
}
