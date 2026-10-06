package dev.marobotic.hourglass.ui

import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.data.Repo
import kotlin.math.roundToInt

private fun markTint(m: String?) = when (m) { "attended" -> HColors.teal; "absent" -> HColors.accent; "off" -> HColors.muted; else -> HColors.faint }
private fun markBox(m: String?) = when (m) { "attended" -> "✓"; "absent" -> "✗"; "off" -> "–"; else -> "" }

// Every subject with every session to the end of term: ✓ attended, ✗ absent,
// – off (no class), empty = not marked yet. Tap a box to change it; upcoming
// sessions are faded. Same page as the desktop's Attendance tab.
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AttendanceScreen(nav: Nav, version: Int, clock: Long) {
    val repo = nav.repo
    // Re-read when anything syncs in, and as sessions pass.
    val list = remember(version, clock / 60_000) { repo.attendanceSessions() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((m, label) in listOf("attended" to "attended", "absent" to "absent", "off" to "off (no class)", null to "not marked")) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        MarkCell(m, 18, null)
                        T(label, 12, HColors.muted)
                    }
                }
            }
        }
        if (list.isEmpty()) item { T("No courses yet.", 14, HColors.faint) }
        items(list, key = { it.first.id }) { (course, sessions) -> CourseAttendance(repo, course, sessions) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CourseAttendance(repo: Repo, course: org.json.JSONObject, sessions: List<Repo.Session>) {
    val past = sessions.count { !it.future }
    fun count(m: String?) = sessions.count { it.mark == m && (m != null || !it.future) }
    val yes = count("attended"); val no = count("absent"); val off = count("off"); val open = count(null)
    val pct = if (yes + no > 0) (100.0 * yes / (yes + no)).roundToInt() else null
    HCard(Modifier.fillMaxWidth(), stripe = hex(course.optString("color"))) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            T(course.optString("name"), 17, bold = true, maxLines = 1, modifier = Modifier.weight(1f))
            T(pct?.let { "$it%" } ?: "—", 20, if (pct != null && pct < 75) HColors.accent else HColors.teal, bold = true)
        }
        Spacer(Modifier.height(4.dp))
        T("✓ $yes  ✗ $no  – $off" + (if (open > 0) "  · $open not marked" else "") + "  ·  $past so far, ${sessions.size - past} to come", 12, HColors.muted)
        Spacer(Modifier.height(10.dp))
        if (sessions.isEmpty()) T("No sessions scheduled.", 13, HColors.faint)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (s in sessions) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.alpha(if (s.future && s.mark == null) 0.35f else 1f)) {
                    MarkCell(s.mark, 34) { repo.cycleMark(s) }
                    T("${s.date.dayOfMonth} ${s.date.month.name.take(3).lowercase().replaceFirstChar { it.uppercase() }}", 10, HColors.faint)
                }
            }
        }
        if (open > 0) {
            Spacer(Modifier.height(10.dp))
            HButton("Mark the $open unmarked as attended") { for (s in sessions) if (s.mark == null && !s.future) repo.setMark(s.occ, "attended") }
        }
    }
}

@Composable
private fun MarkCell(mark: String?, size: Int, onClick: (() -> Unit)?) {
    val tint = markTint(mark)
    Box(
        Modifier.size(size.dp)
            .background(if (mark != null) tint.copy(alpha = 0.25f) else Color.Transparent)
            .border(1.dp, if (mark != null) tint else HColors.faint)
            .let { if (onClick != null) it.clickable(onClick = onClick) else it },
        contentAlignment = Alignment.Center,
    ) { T(markBox(mark), if (size > 20) 17 else 12, tint, bold = true) }
}
