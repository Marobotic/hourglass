package dev.marobotic.hourglass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Search
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.core.str
import java.time.LocalDate

// Notes like Google Keep: course chips, a "Take a note" bar, and a two-column
// staggered grid of cards tinted with the course colour.
@Composable
fun NotesScreen(nav: Nav, version: Int, initial: String = "all") {
    val repo = nav.repo
    var sel by rememberSaveable { mutableStateOf(initial) }
    var query by rememberSaveable { mutableStateOf("") }
    var searching by rememberSaveable { mutableStateOf(false) }
    val courses = remember(version) { repo.courses() }
    val course = courses.firstOrNull { it.id == sel }
    val today = LocalDate.now(repo.zone)
    val words = query.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
    val notes = remember(version, sel, query) {
        repo.notes()
            .filter { when (sel) { "all" -> true; "inbox" -> it.str("course_id") == null; else -> it.str("course_id") == sel } }
            .filter { n -> words.isEmpty() || (n.optString("title") + "\n" + dev.marobotic.hourglass.core.NoteFormat.plainText(n.optString("body"))).lowercase().let { h -> words.all { it in h } } }
            .sortedWith(compareByDescending<org.json.JSONObject> { it.optInt("pinned") }.thenByDescending { it.optLong("updated_at") })
    }

    LazyVerticalStaggeredGrid(
        StaggeredGridCells.Fixed(2), Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalItemSpacing = 8.dp,
    ) {
        item(span = StaggeredGridItemSpan.FullLine) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                T("Notes", 22, bold = true, modifier = Modifier.weight(1f).padding(start = 4.dp))
                IconButton({ searching = !searching; if (!searching) query = "" }) { Icon(if (searching) Icons.Outlined.Close else Icons.Outlined.Search, "Search", tint = HColors.muted) }
            }
        }
        if (searching) item(span = StaggeredGridItemSpan.FullLine) { Field(query, { query = it }, "Search", Modifier.fillMaxWidth()) }
        item(span = StaggeredGridItemSpan.FullLine) {
            CourseFilter(sel, courses, { sel = it }) { nav.sheets.course = true to null }
        }
        if (course != null) item(span = StaggeredGridItemSpan.FullLine) {
            T(listOfNotNull(course.optString("name"), course.str("location"), course.str("teacher")?.substringBefore(",")).joinToString("  ·  "), 13, HColors.muted, maxLines = 2,
                modifier = Modifier.clickable { nav.sheets.course = false to course }.padding(horizontal = 4.dp, vertical = 2.dp))
        }
        item(span = StaggeredGridItemSpan.FullLine) {
            Row(
                Modifier.fillMaxWidth().background(HColors.surface).border(1.dp, HColors.border)
                    .clickable { nav.openNote(repo.addNote(course?.id, today, null)) }.padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                T(if (course != null) "Take a note for ${course.optString("name")}…" else "Take a note…", 15, HColors.muted, modifier = Modifier.weight(1f))
                Icon(Icons.Outlined.EditNote, null, tint = HColors.muted)
            }
        }
        items(notes, key = { it.id }) { n ->
            val c = repo.course(n.str("course_id"))
            val tint = c?.let { hex(it.optString("color")) }
            Column(
                Modifier.fillMaxWidth()
                    .background(if (tint != null) androidx.compose.ui.graphics.lerp(HColors.bg, tint, 0.14f) else HColors.surface)
                    .border(1.dp, tint?.copy(alpha = 0.45f) ?: HColors.border)
                    .clickable { nav.openNote(n) }.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (n.optString("title").isNotBlank()) Row(verticalAlignment = Alignment.Top) {
                    T(n.optString("title"), 15, bold = true, modifier = Modifier.weight(1f))
                    if (n.optInt("pinned") == 1) Icon(Icons.Outlined.PushPin, null, tint = HColors.gold, modifier = Modifier.size(14.dp))
                }
                if (n.optString("body").isNotBlank()) androidx.compose.material3.Text(
                    dev.marobotic.hourglass.core.NoteFormat.plainText(n.optString("body")), color = HColors.fg.copy(alpha = 0.85f), fontSize = 14.sp, lineHeight = 19.sp, maxLines = 10,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, fontFamily = FontFamily.Default,
                )
                val foot = listOfNotNull(if (sel == "all") c?.let { it.optString("name") } else null, n.str("session_date")?.let { Dates.short(it) })
                if (foot.isNotEmpty()) T(foot.joinToString("  ·  "), 11, tint ?: HColors.muted, bold = true)
            }
        }
        if (notes.isEmpty()) item(span = StaggeredGridItemSpan.FullLine) {
            T(if (query.isNotBlank()) "No notes match." else "Notes you take will show up here.", 14, HColors.faint, modifier = Modifier.padding(top = 20.dp))
        }
    }
}

// "All" first, then each subject, then notes with no course: one dropdown
// instead of a row of chips.
@Composable
private fun CourseFilter(sel: String, courses: List<org.json.JSONObject>, onPick: (String) -> Unit, onNewCourse: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    val course = courses.firstOrNull { it.id == sel }
    val label = when (sel) { "all" -> "All notes"; "inbox" -> "No course"; else -> course?.optString("name") ?: "All notes" }
    Box {
        Row(
            Modifier.fillMaxWidth().background(HColors.surface).border(1.dp, HColors.border).clickable { open = true }.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (course != null) { Box(Modifier.size(10.dp).background(hex(course.optString("color")))); Spacer(Modifier.width(10.dp)) }
            T(label, 15, bold = true, maxLines = 1, modifier = Modifier.weight(1f))
            Icon(Icons.Outlined.ArrowDropDown, "Choose", tint = HColors.muted)
        }
        androidx.compose.material3.DropdownMenu(open, { open = false }, containerColor = HColors.surface) {
            @Composable
            fun Item(text: String, swatch: Color?, on: Boolean, action: () -> Unit) = androidx.compose.material3.DropdownMenuItem(
                text = { T(text, 14, if (on) HColors.fg else HColors.muted, bold = on) },
                leadingIcon = { Box(Modifier.size(10.dp).background(swatch ?: Color.Transparent)) },
                onClick = { open = false; action() },
            )
            Item("All notes", null, sel == "all") { onPick("all") }
            for (c in courses) Item(c.optString("name"), hex(c.optString("color")), sel == c.id) { onPick(c.id) }
            Item("No course", null, sel == "inbox") { onPick("inbox") }
            androidx.compose.material3.HorizontalDivider(color = HColors.border)
            Item("+ New course", null, false, onNewCourse)
        }
    }
}

@Composable
private fun Folder(label: String, swatch: Color?, on: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.background(if (on) HColors.surface2 else Color.Transparent).border(1.dp, if (on) HColors.faint else HColors.border)
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (swatch != null) { Box(Modifier.size(10.dp).background(swatch)); Spacer(Modifier.width(8.dp)) }
        T(label, 14, if (on) HColors.fg else HColors.muted, bold = on)
    }
}
