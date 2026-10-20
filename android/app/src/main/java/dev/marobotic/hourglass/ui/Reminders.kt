package dev.marobotic.hourglass.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddAlert
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.dp
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.ReminderState
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.core.ints
import dev.marobotic.hourglass.core.str
import org.json.JSONObject

// Reminders: "call mom at 6". Not alarms: at its time one shows a
// notification (Done, Snooze) and, if chosen, a short tone; then it waits as
// overdue until ticked, like a to-do. Settings has their own section.
@Composable
fun RemindersScreen(nav: Nav, version: Int, clock: Long) {
    val repo = nav.repo
    val all = remember(version, clock / 30_000) { repo.reminders(clock) }
    val open = all.filter { !it.second.done }
    val done = all.filter { it.second.done }.take(20)
    var showDone by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (open.isEmpty()) item { T("No reminders. Tap + to add one, or ask the assistant: \"remind me to call mom at 6\".", 13, HColors.muted) }
            items(open, key = { it.first.id }) { (r, s) -> ReminderRow(nav, r, s, clock) }
            if (done.isNotEmpty()) item {
                Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Section("Done", "${done.size}", Modifier.weight(1f))
                    HButton(if (showDone) "Hide" else "Show") { showDone = !showDone }
                }
            }
            if (showDone) items(done, key = { "d" + it.first.id }) { (r, s) -> ReminderRow(nav, r, s, clock) }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    T(if (repo.reminderStyle == "silent") "Notification only · snooze ${repo.reminderSnooze} min" else "Notification + ${repo.reminderTone.replaceFirstChar { it.uppercase() }} tone · snooze ${repo.reminderSnooze} min", 12, HColors.faint, modifier = Modifier.weight(1f))
                    HButton("Settings") { nav.sheets.settings = true }
                }
            }
            item { Spacer(Modifier.height(72.dp)) }
        }
        FloatingActionButton({ nav.sheets.reminder = Pair(true, null) }, Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = HColors.accent, shape = RectangleShape) {
            Icon(Icons.Outlined.AddAlert, "Add reminder", tint = Color.White)
        }
    }
}

@Composable
private fun ReminderRow(nav: Nav, r: JSONObject, s: ReminderState, clock: Long) {
    val repo = nav.repo
    HCard(Modifier.fillMaxWidth().alpha(if (s.done) 0.55f else 1f), stripe = if (s.overdue) HColors.accent else null, onClick = { nav.sheets.reminder = Pair(false, r) }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton({ repo.reminderDone(r.id, !s.done) }) {
                Icon(if (s.done) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked, if (s.done) "Not done" else "Done", tint = if (s.done) HColors.teal else HColors.muted, modifier = Modifier.size(26.dp))
            }
            Column(Modifier.weight(1f)) {
                T(r.optString("label").ifBlank { "Reminder" }, 15, bold = !s.done, maxLines = 2)
                T(whenText(nav, r, s, clock), 12, if (s.overdue) HColors.accent else HColors.muted, maxLines = 1)
            }
            if (s.overdue) IconButton({ repo.snoozeReminder(r.id) }) { Icon(Icons.Outlined.Snooze, "Snooze", tint = HColors.muted) }
            IconButton({ repo.removeReminder(r.id) }) { Icon(Icons.Outlined.Delete, "Delete", tint = HColors.faint) }
        }
    }
}

private fun whenText(nav: Nav, r: JSONObject, s: ReminderState, clock: Long): String {
    val zone = nav.repo.zone
    val days = r.ints("days")
    val repeat = when {
        days.isEmpty() -> null
        days.size == 7 -> "Every day"
        days == listOf(1, 2, 3, 4, 5) -> "Weekdays"
        days == listOf(6, 7) -> "Weekends"
        else -> days.joinToString(", ") { Dates.WEEKDAYS[it - 1] }
    }
    if (s.done) return "Done" + (r.str("time")?.let { " · " + Dates.t(it) } ?: "")
    val at = s.dueAt ?: s.occurrence
    val day = at?.let {
        val d = Dates.local(it, zone).toLocalDate()
        val today = Dates.local(clock, zone).toLocalDate()
        when (d) { today -> "today"; today.plusDays(1) -> "tomorrow"; today.minusDays(1) -> "yesterday"; else -> Dates.short(d) }
    }
    val time = at?.let { Dates.clock(it, zone) } ?: r.str("time")?.let { Dates.t(it) } ?: ""
    val snoozed = (if (r.isNull("snooze_at")) 0L else r.optLong("snooze_at")) > clock
    return listOfNotNull("$time ${day ?: ""}".trim(), repeat, if (snoozed) "snoozed" else if (s.overdue) "overdue" else null).joinToString(" · ")
}

// New (Pair(true, null)) or edit (Pair(false, row)).
@Composable
fun ReminderSheet(nav: Nav, row: JSONObject?, onDismiss: () -> Unit) {
    val repo = nav.repo
    var label by remember { mutableStateOf(row?.optString("label") ?: "") }
    val startTime = remember { row?.str("time") ?: Dates.local(System.currentTimeMillis() + 3_600_000, repo.zone).let { "%02d:00".format(it.hour) } }
    var time by remember { mutableStateOf(startTime) }
    var repeats by remember { mutableStateOf(row?.ints("days")?.isNotEmpty() == true) }
    var days by remember { mutableStateOf(row?.ints("days")?.takeIf { it.isNotEmpty() } ?: listOf(1, 2, 3, 4, 5)) }
    var date by remember { mutableStateOf(row?.str("date")) }
    Sheet(if (row == null) "New reminder" else "Reminder", onDismiss) {
        Field(label, { label = it }, "Remind me to", Modifier.fillMaxWidth())
        TimeField(time, { time = it }, "TIME", Modifier.fillMaxWidth())
        Segmented(listOf("Once" to false, "Repeats" to true), repeats) { repeats = it }
        if (repeats) {
            DayToggles(days) { days = it }
            T("Shows on the highlighted days; tick it done each time.", 12, HColors.faint)
        } else {
            DateField(date, { date = it }, "DAY", Modifier.fillMaxWidth(), clearable = true)
            T(if (date == null) "Today, or tomorrow if that time has passed." else "Shows once, then waits until you tick it done.", 12, HColors.faint)
        }
        HButton(if (row == null) "Add reminder" else "Save", Modifier.fillMaxWidth(), primary = true, enabled = label.isNotBlank() && (!repeats || days.isNotEmpty())) {
            if (row == null) repo.addReminder(label, time, if (repeats) null else date, if (repeats) days else emptyList())
            else repo.editReminder(row.id, label, time, if (repeats) null else date ?: repo.nextDateFor(time), if (repeats) days else emptyList())
            onDismiss()
        }
        if (row != null) HButton("Delete", Modifier.fillMaxWidth(), danger = true) { repo.removeReminder(row.id); onDismiss() }
    }
}
