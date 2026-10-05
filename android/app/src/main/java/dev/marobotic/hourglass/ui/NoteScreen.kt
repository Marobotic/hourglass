package dev.marobotic.hourglass.ui

import androidx.compose.ui.graphics.RectangleShape

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.str
import kotlinx.coroutines.delay

// Markdown note editor. Autosaves 700 ms after the last keystroke and on exit.
@Composable
fun NoteScreen(nav: Nav, id: String, version: Int) {
    val repo = nav.repo
    val initial = remember(id) { repo.store.get("notes", id) } ?: run { nav.pop(); return }
    val live = remember(version) { repo.store.get("notes", id) } ?: initial
    var title by remember(id) { mutableStateOf(initial.optString("title")) }
    var body by remember(id) { mutableStateOf(initial.optString("body")) }
    var dirty by remember(id) { mutableStateOf(false) }
    val course = remember(version) { repo.course(initial.str("course_id")) }
    val versions = remember(version) { repo.versions(id) }
    var menu by remember { mutableStateOf(false) }
    var showVersions by remember { mutableStateOf(false) }

    fun save() {
        if (!dirty) return
        repo.updateNote(id, mapOf("title" to title, "body" to body))
        dirty = false
    }
    LaunchedEffect(title, body) { if (dirty) { delay(700); save() } }
    DisposableEffect(id) { onDispose { save() } }

    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton({ save(); nav.pop() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back", tint = HColors.fg) }
            Grow()
            T(if (dirty) "Edited" else "Saved", 11, HColors.faint)
            IconButton({ repo.updateNote(id, mapOf("pinned" to if (live.optInt("pinned") == 1) 0 else 1)) }) {
                Icon(Icons.Outlined.PushPin, "Pin", tint = if (live.optInt("pinned") == 1) HColors.gold else HColors.muted)
            }
            IconButton({
                nav.sheets.confirm = Triple("Delete note?", "\"${title.ifBlank { "Untitled" }}\" will be removed from every device.") { dirty = false; repo.deleteNote(id); nav.pop() }
            }) { Icon(Icons.Outlined.Delete, "Delete", tint = HColors.muted) }
            Box {
                IconButton({ menu = true }) { Icon(Icons.Outlined.MoreVert, "More", tint = HColors.muted) }
                androidx.compose.material3.DropdownMenu(menu, { menu = false }, containerColor = HColors.surface) {
                    androidx.compose.material3.DropdownMenuItem(
                        text = { T("Versions" + if (versions.isEmpty()) "  (none yet)" else "  (${versions.size})", 14) },
                        leadingIcon = { Icon(Icons.Outlined.History, null, tint = HColors.muted) },
                        enabled = versions.isNotEmpty(),
                        onClick = { menu = false; save(); showVersions = true },
                    )
                }
            }
        }
        if (showVersions) VersionsDialog(versions, { showVersions = false }) { v ->
            showVersions = false
            nav.sheets.confirm = Triple("Restore this version?", "The note goes back to the text from ${stamp(v.optLong("saved_at"))}. What it says now is kept as a version too.") {
                repo.restoreVersion(v)
                title = v.optString("title"); body = v.optString("body"); dirty = false
            }
        }
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
            // Which course and day this note belongs to; changes save at once.
            androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(6.dp)) {
                val options = listOf<Pair<String, String?>>("No course" to null) + repo.courses().map { (it.optString("name")) to it.optString("id") }
                items(options.size) { i ->
                    val (label, cid) = options[i]
                    val on = cid == live.str("course_id")
                    T(label, 13, if (on) HColors.fg else HColors.muted, bold = on, modifier = Modifier.clip(RectangleShape)
                        .background(if (on) HColors.surface2 else androidx.compose.ui.graphics.Color.Transparent)
                        .clickable { save(); repo.updateNote(id, mapOf("course_id" to cid)) }.padding(horizontal = 10.dp, vertical = 6.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
            DateField(live.str("session_date"), { save(); repo.updateNote(id, mapOf("session_date" to it)) }, "DATE", Modifier.fillMaxWidth(), clearable = true)
            BasicTextField(
                title, { title = it; dirty = true }, Modifier.fillMaxWidth().padding(vertical = 8.dp),
                textStyle = TextStyle(color = HColors.fg, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 26.sp),
                cursorBrush = SolidColor(HColors.accent), singleLine = true,
                decorationBox = { inner -> if (title.isEmpty()) T("Title", 26, HColors.faint, bold = true); inner() },
            )
            Box(Modifier.fillMaxWidth().height(1.dp).background(HColors.border))
            Spacer(Modifier.height(12.dp))
            BasicTextField(
                body, { body = it; dirty = true }, Modifier.fillMaxSize(),
                textStyle = TextStyle(color = HColors.fg, fontFamily = Mono, fontSize = 15.sp, lineHeight = 22.sp),
                cursorBrush = SolidColor(HColors.accent),
                decorationBox = { inner -> if (body.isEmpty()) T("Write in Markdown. # headings, - lists, **bold**.", 15, HColors.faint); inner() },
            )
        }
    }
}

private fun stamp(ms: Long): String = java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneId.systemDefault()).let {
    Dates.short(it.toLocalDate()) + " " + Dates.t("%02d:%02d".format(it.hour, it.minute))
}

// Older text of this note, newest first; tap one to put it back.
@Composable
private fun VersionsDialog(versions: List<org.json.JSONObject>, onDismiss: () -> Unit, onPick: (org.json.JSONObject) -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss, containerColor = HColors.surface, shape = RectangleShape,
        title = { T("Versions", 18, bold = true) },
        text = {
            androidx.compose.foundation.lazy.LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(versions.size) { i ->
                    val v = versions[i]
                    Column(Modifier.fillMaxWidth().clickable { onPick(v) }.padding(vertical = 10.dp)) {
                        T(stamp(v.optLong("saved_at")) + when (v.optString("reason")) { "conflict" -> "  ·  from another device"; "restore" -> "  ·  before a restore"; else -> "" }, 12, HColors.muted)
                        T(v.optString("title").ifBlank { "Untitled" }, 14, bold = true, maxLines = 1)
                        T(v.optString("body").replace(Regex("\\s+"), " ").trim().ifBlank { "(empty)" }, 13, HColors.fg.copy(alpha = 0.8f), maxLines = 3)
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(HColors.border))
                }
            }
        },
        confirmButton = { HButton("Close", onClick = onDismiss) },
    )
}
