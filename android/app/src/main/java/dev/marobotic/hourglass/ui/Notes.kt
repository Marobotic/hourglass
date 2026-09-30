package dev.marobotic.hourglass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Search
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.dp
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.core.str
import org.json.JSONObject
import java.time.LocalDate

// Notes first: one line of controls, folder chips, then the notes. Course
// details fold away behind the info button; + writes a note dated today.
@Composable
fun NotesScreen(nav: Nav, version: Int, initial: String = "all") {
    val repo = nav.repo
    var sel by rememberSaveable { mutableStateOf(initial) }
    var query by rememberSaveable { mutableStateOf("") }
    var searching by rememberSaveable { mutableStateOf(false) }
    var info by rememberSaveable { mutableStateOf(false) }
    val courses = remember(version) { repo.courses() }
    val all = remember(version) { repo.notes().sortedByDescending { it.optLong("updated_at") } }
    val course = courses.firstOrNull { it.id == sel }
    val today = LocalDate.now(repo.zone)

    fun inSel(n: JSONObject) = when (sel) { "all" -> true; "inbox" -> n.str("course_id") == null; else -> n.str("course_id") == sel }
    val list = all.filter(::inSel)
    val groups = buildList {
        val pinned = list.filter { it.optInt("pinned") == 1 }
        if (pinned.isNotEmpty()) add("Pinned" to pinned)
        val byDate = list.filter { it.optInt("pinned") != 1 }.groupBy { it.str("session_date") ?: "" }
        for (k in byDate.keys.filter { it.isNotEmpty() }.sortedDescending()) add(((if (k == today.toString()) "Today · " else "") + Dates.short(k)) to byDate.getValue(k))
        byDate[""]?.let { add("No date" to it) }
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, bottom = 88.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    T(course?.optString("name") ?: if (sel == "inbox") "No course" else "Notes", 20, bold = true, maxLines = 1, modifier = Modifier.weight(1f))
                    if (course != null) IconButton({ info = !info }) { Icon(Icons.Outlined.Info, "Course details", tint = if (info) HColors.fg else HColors.muted) }
                    IconButton({ searching = !searching; if (!searching) query = "" }) { Icon(if (searching) Icons.Outlined.Close else Icons.Outlined.Search, "Search", tint = HColors.muted) }
                }
            }
            if (searching) item { Field(query, { query = it }, "Search all notes", Modifier.fillMaxWidth()) }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    item { Folder("All", null, sel == "all") { sel = "all" } }
                    items(courses, key = { it.id }) { c -> Folder(c.str("code") ?: c.optString("name"), hex(c.optString("color")), sel == c.id) { sel = c.id } }
                    item { Folder("No course", null, sel == "inbox") { sel = "inbox" } }
                    item { Folder("+ Course", null, false) { nav.sheets.course = true to null } }
                }
            }
            if (course != null && info) item {
                HCard(Modifier.fillMaxWidth(), stripe = hex(course.optString("color"))) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        T(listOfNotNull(course.str("code"), course.str("location")).joinToString("  ·  "), 14, bold = true, modifier = Modifier.weight(1f))
                        IconButton({ nav.sheets.course = false to course }) { Icon(Icons.Outlined.Edit, "Edit", tint = HColors.muted) }
                    }
                    course.str("teacher")?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() }?.forEach { T(it, 13, HColors.muted) }
                    Spacer(Modifier.height(6.dp))
                    for (e in repo.events().filter { it.str("course_id") == course.id }) {
                        T("${kindLabel(e.optString("kind"))}  ${Dates.range(e.optString("start_time"), e.optString("end_time"))}  ${repeatText(e)}", 13,
                            maxLines = 1, modifier = Modifier.clickable { nav.sheets.event = e to emptyMap() }.padding(vertical = 3.dp))
                    }
                }
            }
            if (searching && query.isNotBlank()) {
                val words = query.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
                val hits = all.filter { n -> val h = (n.optString("title") + "\n" + n.optString("body")).lowercase(); words.all { it in h } }
                item { Section("${hits.size} result${if (hits.size == 1) "" else "s"}") }
                items(hits, key = { "q" + it.id }) { NoteRow(it, repo.course(it.str("course_id"))) { nav.openNote(it) } }
            } else {
                for ((label, notes) in groups) {
                    item(key = "g$label") { Section(label) }
                    items(notes, key = { "n" + it.id }) { NoteRow(it, if (course == null) repo.course(it.str("course_id")) else null) { nav.openNote(it) } }
                }
                if (groups.isEmpty()) item { T("No notes yet. Tap + to write one.", 14, HColors.faint, modifier = Modifier.padding(top = 12.dp)) }
            }
        }
        FloatingActionButton({ nav.openNote(repo.addNote(course?.id, today, null)) }, Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = HColors.accent, shape = RectangleShape) {
            Icon(Icons.Outlined.EditNote, "New note", tint = Color.White)
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
