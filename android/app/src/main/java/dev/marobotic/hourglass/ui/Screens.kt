package dev.marobotic.hourglass.ui

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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

@Composable
fun NowScreen(nav: Nav, version: Int, clock: Long) {
    val repo = nav.repo
    val minute = clock / 60_000
    val st = remember(version, minute) { repo.now(clock) }
    val timers = remember(version) { repo.timers() }
    val zone = repo.zone
    LazyColumn(Modifier.fillMaxSize(), contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Column {
                T(Dates.long(st.today), 13, HColors.muted)
                T(Dates.clock(clock, zone), 40, bold = true)
            }
        }
        item {
            val f = st.focus
            if (f != null) Hero(nav, f, st.notes.session, clock)
            else HCard(Modifier.fillMaxWidth()) {
                T(if (repo.courses().isEmpty()) "Welcome to Hourglass" else "Nothing on right now", 20, bold = true)
                Spacer(Modifier.height(6.dp))
                val nx = st.next
                T(when {
                    nx != null -> "Next: ${nx.title}, ${Dates.short(nx.date)} at ${nx.startTime} (${Dates.relative((nx.startMs - clock) / 60_000)})"
                    repo.courses().isEmpty() -> "Add your courses and their weekly times. During each lecture its notes open right here."
                    else -> "Nothing scheduled in the next 7 days."
                }, 13, HColors.muted)
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (repo.courses().isEmpty()) HButton("Add a course", primary = true, icon = Icons.Outlined.Add) { nav.sheets.course = true to null }
                    else if (nx != null) HButton("Open next session", icon = Icons.Outlined.FolderOpen) { nav.sheets.session = nx }
                }
            }
        }
        if (st.focus != null) {
            item { Section("This session", Dates.short(st.focus!!.date)) }
            if (st.notes.session.isEmpty()) item { T("No notes yet for this session.", 12, HColors.faint) }
            items(st.notes.session, key = { "s" + it.id }) { NoteRow(it) { nav.openNote(it) } }
            if (st.notes.pinned.isNotEmpty()) {
                item { Section("Pinned") }
                items(st.notes.pinned, key = { "p" + it.id }) { NoteRow(it) { nav.openNote(it) } }
            }
            if (st.notes.last.isNotEmpty()) {
                item { Section("Last time", st.notes.lastDate?.let { Dates.short(it) }) }
                items(st.notes.last, key = { "l" + it.id }) { NoteRow(it) { nav.openNote(it) } }
            }
        }
        item { Section("Today") }
        if (st.todayList.isEmpty()) item { T("Nothing scheduled today.", 12, HColors.faint) }
        items(st.todayList, key = { "t" + it.eventId + it.date }) { o -> TimelineRow(o, clock) { nav.sheets.session = o } }
        item { Section("Timers") }
        items(timers, key = { "tm" + it.id }) { TimerCard(nav, it, clock) }
        item {
            @OptIn(ExperimentalLayoutApi::class)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (m in listOf(5, 10, 25, 50)) HButton("$m min") { repo.startTimer(m * 60, if (st.active?.state(clock) == "live") st.active!!.title else "") }
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
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
            if (live) { Box(Modifier.size(8.dp).alpha(pulse).clip(CircleShape).background(HColors.accent)); Spacer(Modifier.width(8.dp)) }
            T(when (state) { "live" -> "LIVE NOW"; "ended" -> "JUST ENDED"; else -> "UP NEXT" }, 11, if (live) HColors.accent else HColors.muted, bold = true, spacing = 1.6)
            Spacer(Modifier.width(8.dp))
            Chip(kindLabel(f.kind), color)
            Grow()
            T("${f.startTime}–${f.endTime}", 13, HColors.muted)
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
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(HColors.surface2)) {
            Box(Modifier.fillMaxWidth(if (live) f.progress(clock) else 0f).fillMaxHeight().clip(RoundedCornerShape(3.dp)).background(color))
        }
        Spacer(Modifier.height(6.dp))
        T(when (state) {
            "live" -> Dates.left((f.endMs - clock + 59_999) / 60_000)
            "ended" -> "Ended ${f.endTime}. Good time to tidy your notes."
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
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (live) color.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 10.dp).alpha(if (past) 0.5f else 1f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.width(52.dp)) { T(o.startTime, 14, bold = true); T(o.endTime, 11, HColors.faint) }
        Box(Modifier.width(3.dp).height(34.dp).clip(RoundedCornerShape(2.dp)).background(color))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            T(o.title, 14, maxLines = 1)
            T(listOfNotNull(o.location?.substringBefore(" · "), kindLabel(o.kind), o.courseCode).joinToString(" · "), 12, HColors.muted, maxLines = 1)
        }
        if (live) Box(Modifier.size(8.dp).clip(CircleShape).background(HColors.accent))
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
            Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(HColors.surface2)) {
                Box(Modifier.fillMaxWidth(frac).fillMaxHeight().background(HColors.accent))
            }
        }
    }
}

// ------------------------------------------------------------------ Week (agenda on phones)

@Composable
fun WeekScreen(nav: Nav, version: Int, clock: Long) {
    val repo = nav.repo
    val today = remember(clock / 60_000) { LocalDate.now(repo.zone) }
    var weekStart by rememberSaveable { mutableStateOf(Dates.weekStart(today).toString()) }
    var selected by rememberSaveable { mutableStateOf(today.toString()) }
    val ws = LocalDate.parse(weekStart)
    val occ = remember(version, weekStart) { repo.occurrences(ws, ws.plusDays(6)) }
    val sel = LocalDate.parse(selected)
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(ScreenPadding)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    T("${ws.month.name.lowercase().replaceFirstChar { it.uppercase() }} ${ws.year}", 13, HColors.muted)
                    T("${ws.dayOfMonth} – ${Dates.short(ws.plusDays(6)).drop(4)}", 24, bold = true)
                }
                IconButton({ weekStart = ws.minusWeeks(1).toString(); selected = ws.minusWeeks(1).toString() }) { Icon(Icons.Outlined.ChevronLeft, null, tint = HColors.fg) }
                IconButton({ weekStart = Dates.weekStart(today).toString(); selected = today.toString() }) { T("Today", 12, HColors.muted) }
                IconButton({ weekStart = ws.plusWeeks(1).toString(); selected = ws.plusWeeks(1).toString() }) { Icon(Icons.Outlined.ChevronRight, null, tint = HColors.fg) }
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (i in 0..6) {
                    val d = ws.plusDays(i.toLong())
                    val isSel = d == sel
                    val isToday = d == today
                    val dayOcc = occ.filter { it.date == d }
                    Column(
                        Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(if (isSel) HColors.surface2 else Color.Transparent)
                            .border(1.dp, if (isSel) HColors.faint else HColors.border, RoundedCornerShape(8.dp)).clickable { selected = d.toString() }.padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        T(Dates.WEEKDAYS[i].take(1), 11, if (isToday) HColors.accent else HColors.muted, bold = true)
                        T("${d.dayOfMonth}", 16, if (isToday) HColors.accent else HColors.fg, bold = true)
                        Row(horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.height(6.dp).padding(top = 2.dp)) {
                            for (o in dayOcc.take(4)) Box(Modifier.size(4.dp).clip(CircleShape).background(hex(o.color)))
                        }
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            Section(Dates.long(sel))
            val list = occ.filter { it.date == sel }
            if (list.isEmpty()) T("Nothing scheduled.", 12, HColors.faint, modifier = Modifier.padding(top = 8.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(list, key = { it.eventId + it.date }) { o -> TimelineRow(o, clock) { nav.sheets.session = o } }
            }
        }
        FloatingActionButton({ nav.sheets.event = null to mapOf("date" to selected) }, Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = HColors.accent) {
            Icon(Icons.Outlined.Add, "Add event", tint = Color.White)
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
                        T(a.str("time") ?: "-${a.optInt("lead_minutes")}′", 28, bold = true, modifier = Modifier.width(104.dp))
                        Column(Modifier.weight(1f)) {
                            T(a.optString("label"), 14, maxLines = 1)
                            val days = a.ints("days")
                            val sub = when {
                                a.str("lead_course_id") != null || a.str("lead_event_id") != null -> "${a.optInt("lead_minutes")} min before every session"
                                a.str("date") != null -> "Once, " + Dates.short(a.optString("date"))
                                days.isEmpty() -> "Every day"
                                days == listOf(1, 2, 3, 4, 5) -> "Weekdays"
                                else -> days.joinToString(", ") { Dates.WEEKDAYS[it - 1] }
                            }
                            T(sub + (next?.let { "  ·  next " + Dates.short(Dates.local(it, repo.zone).toLocalDate()) + " " + Dates.clock(it, repo.zone) } ?: ""), 11, HColors.muted, maxLines = 2)
                        }
                        Switch(on, { repo.setAlarmEnabled(a.id, it) }, colors = SwitchDefaults.colors(checkedTrackColor = HColors.accent, checkedThumbColor = Color.White, uncheckedTrackColor = HColors.surface2))
                        IconButton({ repo.removeAlarm(a.id) }) { Icon(Icons.Outlined.Delete, "Delete", tint = HColors.muted) }
                    }
                }
            }
            item { Spacer(Modifier.height(72.dp)) }
        }
        FloatingActionButton({ nav.sheets.alarm = true }, Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = HColors.accent) {
            Icon(Icons.Outlined.Alarm, "Add alarm", tint = Color.White)
        }
    }
}
