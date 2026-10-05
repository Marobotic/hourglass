package dev.marobotic.hourglass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.dp
import dev.marobotic.hourglass.core.Block
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.merge
import java.time.LocalDate

// Week: the week's days as lists of blocks. Month: a grid; tap a day for its list.
@Composable
fun ScheduleScreen(nav: Nav, version: Int, clock: Long) {
    val repo = nav.repo
    val today = remember(clock / 60_000) { LocalDate.now(repo.zone) }
    var month by rememberSaveable { mutableStateOf(false) }
    var anchor by rememberSaveable { mutableStateOf(today.toString()) }
    var picked by rememberSaveable { mutableStateOf(today.toString()) }
    val a = LocalDate.parse(anchor)
    val ws = Dates.displayWeekStart(a)
    val first = a.withDayOfMonth(1)
    val gridStart = Dates.displayWeekStart(first)
    val weeks = ((java.time.temporal.ChronoUnit.DAYS.between(gridStart, first.plusMonths(1).minusDays(1)) + 1 + 6) / 7).toInt()
    val from = if (month) gridStart else ws
    val to = if (month) gridStart.plusDays(weeks * 7L - 1) else ws.plusDays(6)
    val blocks = remember(version, from, to) { merge(repo.occurrences(from, to)) }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, bottom = 88.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        T(if (month) "${first.month.name.lowercase().replaceFirstChar { it.uppercase() }} ${first.year}" else "${Dates.short(ws)} – ${Dates.short(ws.plusDays(6))}", 18, bold = true, maxLines = 1)
                    }
                    IconButton({ anchor = (if (month) first.minusMonths(1) else ws.minusWeeks(1)).toString() }) { Icon(Icons.Outlined.ChevronLeft, "Back", tint = HColors.fg) }
                    IconButton({ anchor = (if (month) first.plusMonths(1) else ws.plusWeeks(1)).toString() }) { Icon(Icons.Outlined.ChevronRight, "Forward", tint = HColors.fg) }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Tab("Week", !month) { month = false }
                    Tab("Month", month) { month = true }
                    Spacer(Modifier.weight(1f))
                    Tab("Today", false) { anchor = today.toString(); picked = today.toString() }
                }
            }
            if (!month) {
                for (i in 0..6) {
                    val d = ws.plusDays(i.toLong())
                    val list = blocks.filter { it.first.date == d }
                    item(key = "d$d") { Section((if (d == today) "Today · " else "") + Dates.long(d)) }
                    if (list.isEmpty()) item(key = "e$d") { T("Free", 13, HColors.faint) }
                    items(list, key = { "b" + it.first.eventId + it.first.date }) { b -> BlockCard(b, clock) { nav.sheets.session = b.first } }
                }
            } else {
                item {
                    Column {
                        Row { for (i in 0..6) T(Dates.WEEKDAYS[Dates.iso(gridStart.plusDays(i.toLong())) - 1].take(2), 12, HColors.muted, modifier = Modifier.weight(1f).padding(bottom = 4.dp)) }
                        for (w in 0 until weeks) Row {
                            for (i in 0..6) {
                                val d = gridStart.plusDays(w * 7L + i)
                                val list = blocks.filter { it.first.date == d }
                                val inMonth = d.month == first.month
                                Column(
                                    Modifier.weight(1f).aspectRatio(0.8f).border(0.5.dp, HColors.border)
                                        .background(if (d.toString() == picked) HColors.surface2 else Color.Transparent)
                                        .clickable { picked = d.toString() }.padding(4.dp),
                                    verticalArrangement = Arrangement.spacedBy(3.dp),
                                ) {
                                    T("${d.dayOfMonth}", 14, if (d == today) HColors.accent else if (inMonth) HColors.fg else HColors.faint, bold = d == today)
                                    for (b in list.take(3)) Box(Modifier.fillMaxWidth().height(5.dp).background(hex(b.first.color)))
                                }
                            }
                        }
                    }
                }
                val pd = LocalDate.parse(picked)
                val list = blocks.filter { it.first.date == pd }
                item { Section((if (pd == today) "Today · " else "") + Dates.long(pd)) }
                if (list.isEmpty()) item { T("Free", 13, HColors.faint) }
                items(list, key = { "m" + it.first.eventId + it.first.date }) { b -> BlockCard(b, clock) { nav.sheets.session = b.first } }
            }
        }
        FloatingActionButton({ nav.sheets.event = null to mapOf("date" to (if (month) picked else today.toString())) }, Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = HColors.accent, shape = RectangleShape) {
            Icon(Icons.Outlined.Add, "Add event", tint = Color.White)
        }
    }
}

@Composable
private fun Tab(label: String, on: Boolean, onClick: () -> Unit) {
    Box(Modifier.background(if (on) HColors.surface2 else Color.Transparent).border(1.dp, if (on) HColors.faint else HColors.border).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp)) {
        T(label, 14, if (on) HColors.fg else HColors.muted, bold = on)
    }
}

// One block: course, time range, room and professor, big enough to read at a glance.
@Composable
fun BlockCard(b: Block, clock: Long, onClick: () -> Unit) {
    val o = b.first
    val live = clock >= b.startMs && clock < b.endMs
    val off = o.mark == "off"
    Row(Modifier.fillMaxWidth().alpha(if (off) 0.5f else 1f).background(if (live) hex(o.color).copy(alpha = 0.18f) else HColors.surface).border(1.dp, if (live) hex(o.color) else HColors.border).clickable(onClick = onClick)) {
        Box(Modifier.width(4.dp).height(if (o.teacher != null) 92.dp else 70.dp).background(hex(o.color)))
        Column(Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                T(Dates.range(b.startTime, b.endTime), 16, bold = true, modifier = Modifier.weight(1f))
                o.location?.let { T(it, 16, bold = true) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                T(o.title, 15, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                o.mark?.let { Spacer(Modifier.width(8.dp)); Chip(markLabel(it), markColor(it)) }
            }
            T(b.parts.joinToString(" · ") { "${kindLabel(it.kind)} ${Dates.t(it.startTime)}" }, 12, HColors.muted, maxLines = 1)
            o.teacher?.let { T(it.substringBefore(","), 13, HColors.muted, maxLines = 1) }
        }
    }
}

fun markLabel(m: String) = when (m) { "attended" -> "Attended"; "absent" -> "Absent"; else -> "Off" }
fun markColor(m: String) = when (m) { "attended" -> HColors.teal; "absent" -> HColors.accent; else -> HColors.faint }
