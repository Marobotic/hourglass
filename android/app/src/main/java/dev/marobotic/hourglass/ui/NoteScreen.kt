package dev.marobotic.hourglass.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Delete
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
        }
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (course != null) {
                    Box(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(hex(course.optString("color"))))
                    Spacer(Modifier.width(8.dp))
                    T(course.optString("name"), 13, maxLines = 1)
                }
                T(initial.str("session_date")?.let { (if (course != null) "  ·  " else "") + "session " + Dates.short(it) } ?: if (course == null) "Inbox" else "  ·  course note", 13, HColors.muted, maxLines = 1)
            }
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
