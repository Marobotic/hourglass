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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Person
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.core.str
import org.json.JSONObject
import java.time.LocalDate

// Every note in one place: All, No course, or one course (with its lecturers
// and weekly times). Notes are grouped by the day they belong to.
@Composable
fun NotesScreen(nav: Nav, version: Int, initial: String = "all") {
    val repo = nav.repo
    var sel by rememberSaveable { mutableStateOf(initial) }
    var query by rememberSaveable { mutableStateOf("") }
    val courses = remember(version) { repo.courses() }
    val all = remember(version) { repo.notes().sortedByDescending { it.optLong("updated_at") } }
    val course = courses.firstOrNull { it.id == sel }
    val today = LocalDate.now(repo.zone)
    var newDate by rememberSaveable { mutableStateOf(today.toString()) }

    fun inSel(n: JSONObject) = when (sel) { "all" -> true; "inbox" -> n.str("course_id") == null; else -> n.str("course_id") == sel }
    val list = all.filter(::inSel)
    val groups = buildList {
        val pinned = list.filter { it.optInt("pinned") == 1 }
        if (pinned.isNotEmpty()) add("Pinned" to pinned)
        val byDate = list.filter { it.optInt("pinned") != 1 }.groupBy { it.str("session_date") ?: "" }
        for (k in byDate.keys.filter { it.isNotEmpty() }.sortedDescending()) add(((if (k == today.toString()) "Today · " else "") + Dates.long(LocalDate.parse(k))) to byDate.getValue(k))
        byDate[""]?.let { add("No date" to it) }
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { T("Notes", 26, bold = true) }
            item { Field(query, { query = it }, "Search all notes", Modifier.fillMaxWidth()) }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    item { Folder("All", null, sel == "all") { sel = "all" } }
                    item { Folder("No course", null, sel == "inbox") { sel = "inbox" } }
                    items(courses, key = { it.id }) { c -> Folder(c.str("code") ?: c.optString("name"), hex(c.optString("color")), sel == c.id) { sel = c.id } }
                }
            }
            if (query.isNotBlank()) {
                val words = query.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
                val hits = all.filter { n -> val h = (n.optString("title") + "\n" + n.optString("body")).lowercase(); words.all { it in h } }
                item { Section("${hits.size} result${if (hits.size == 1) "" else "s"}") }
                items(hits, key = { "q" + it.id }) { NoteRow(it, repo.course(it.str("course_id"))) { nav.openNote(it) } }
            } else {
                if (course != null) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.width(5.dp).height(48.dp).clip(RoundedCornerShape(3.dp)).background(hex(course.optString("color"))))
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                T(course.optString("name"), 22, bold = true)
                                T(listOfNotNull(course.str("code"), course.str("location")).joinToString("  ·  "), 14, HColors.muted)
                            }
                            IconButton({ nav.sheets.course = false to course }) { Icon(Icons.Outlined.Edit, "Edit", tint = HColors.muted) }
                        }
                    }
                    val teachers = course.str("teacher")?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()
                    if (teachers.isNotEmpty()) {
                        item { Section("Lecturers") }
                        items(teachers) { t ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.Person, null, tint = HColors.muted, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(8.dp)); T(t, 14)
                            }
                        }
                    }
                    item { Section("Weekly times") }
                    items(repo.events().filter { it.str("course_id") == course.id }, key = { "e" + it.id }) { e ->
                        HCard(Modifier.fillMaxWidth(), onClick = { nav.sheets.event = e to emptyMap() }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Chip(kindLabel(e.optString("kind")), hex(course.optString("color")))
                                Spacer(Modifier.width(10.dp))
                                T("${e.optString("start_time")}–${e.optString("end_time")}", 15, bold = true)
                                Spacer(Modifier.width(10.dp))
                                T(repeatText(e), 13, HColors.muted, maxLines = 1, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
                item {
                    HCard(Modifier.fillMaxWidth()) {
                        T(if (course != null) "New note for ${course.str("code") ?: course.optString("name")}" else "New note", 14, HColors.muted)
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            DateField(newDate, { if (it != null) newDate = it }, "DATE", Modifier.weight(1f))
                            HButton("Write", primary = true, icon = Icons.Outlined.EditNote) {
                                nav.openNote(repo.addNote(course?.id, LocalDate.parse(newDate), null))
                            }
                        }
                    }
                }
                for ((label, notes) in groups) {
                    item(key = "g$label") { Section(label, "${notes.size} note${if (notes.size == 1) "" else "s"}") }
                    items(notes, key = { "n" + it.id }) { NoteRow(it, if (course == null) repo.course(it.str("course_id")) else null) { nav.openNote(it) } }
                }
                if (groups.isEmpty()) item { T(if (course != null) "No notes yet. Notes you take during a session land here, grouped by date." else "No notes yet.", 13, HColors.faint) }
            }
            item { Spacer(Modifier.height(72.dp)) }
        }
        FloatingActionButton({ nav.sheets.course = true to null }, Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = HColors.accent) {
            Icon(Icons.Outlined.Add, "Add course", tint = Color.White)
        }
    }
}

@Composable
private fun Folder(label: String, swatch: Color?, on: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    Row(
        Modifier.clip(shape).background(if (on) HColors.surface2 else Color.Transparent).border(1.dp, if (on) HColors.faint else HColors.border, shape)
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (swatch != null) { Box(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(swatch)); Spacer(Modifier.width(8.dp)) }
        T(label, 14, if (on) HColors.fg else HColors.muted, bold = on)
    }
}
