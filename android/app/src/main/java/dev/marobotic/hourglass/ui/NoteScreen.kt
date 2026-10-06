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
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FormatBold
import androidx.compose.material.icons.outlined.FormatItalic
import androidx.compose.material.icons.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.FormatListNumbered
import androidx.compose.material.icons.outlined.FormatStrikethrough
import androidx.compose.material.icons.outlined.FormatUnderlined
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Title
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.Check
import dev.marobotic.hourglass.core.Md
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue

// The toolbar writes the same Markdown as the desktop's: **bold**, *italic*,
// <u>underline</u>, ~~strike~~, and "## ", "- ", "1. " in front of lines.
// Again on the same selection takes it off.
fun wrapSel(v: TextFieldValue, pre: String, post: String): TextFieldValue {
    val a = v.selection.min; val b = v.selection.max
    val sel = v.text.substring(a, b)
    return if (sel.length >= pre.length + post.length && sel.startsWith(pre) && sel.endsWith(post)) {
        val inner = sel.substring(pre.length, sel.length - post.length)
        TextFieldValue(v.text.substring(0, a) + inner + v.text.substring(b), TextRange(a, a + inner.length))
    } else {
        val out = v.text.substring(0, a) + pre + sel + post + v.text.substring(b)
        TextFieldValue(out, if (sel.isEmpty()) TextRange(a + pre.length) else TextRange(a, a + pre.length + sel.length + post.length))
    }
}

fun prefixLines(v: TextFieldValue, kind: String): TextFieldValue {
    val t = v.text
    val a = t.lastIndexOf('\n', (v.selection.min - 1).coerceAtLeast(-1)).let { if (v.selection.min == 0) 0 else it + 1 }
    var b = t.indexOf('\n', maxOf(v.selection.max - if (v.selection.max > v.selection.min) 1 else 0, a))
    if (b < 0) b = t.length
    val rows = t.substring(a, b).split("\n")
    val re = when (kind) {
        "ul" -> Regex("^[-*] (?!\\[[ xX]] )")
        "todo" -> Regex("^[-*] \\[[ xX]] ")
        "ol" -> Regex("^\\d+\\. ")
        else -> Regex("^#{1,6} ")
    }
    val any = Regex("^([-*] \\[[ xX]] |[-*] |\\d+\\. |#{1,6} )")
    val filled = rows.filter { it.isNotBlank() }
    val on = filled.isNotEmpty() && filled.all { re.containsMatchIn(it) }
    var n = 0
    val out = rows.joinToString("\n") { r ->
        when {
            r.isBlank() -> r
            on -> r.replaceFirst(re, "")
            else -> (when (kind) { "ul" -> "- "; "todo" -> "- [ ] "; "ol" -> "${++n}. "; else -> "## " }) + r.replaceFirst(any, "")
        }
    }
    val text = t.substring(0, a) + out + t.substring(b)
    val pos = a + out.length
    return if (kind == "ol") Md.renumberKeeping(text, pos).let { (x, p) -> TextFieldValue(x, TextRange(p)) } else TextFieldValue(text, TextRange(pos))
}

// A note, two ways: formatted to read (to-dos tick right there), or as Markdown
// to edit. Save shows it formatted; the pencil goes back to editing. While
// editing it autosaves 700 ms after the last keystroke, and on exit.
@Composable
fun NoteScreen(nav: Nav, id: String, version: Int) {
    val repo = nav.repo
    val initial = remember(id) { repo.store.get("notes", id) } ?: run { nav.pop(); return }
    val live = remember(version) { repo.store.get("notes", id) } ?: initial
    var title by remember(id) { mutableStateOf(initial.optString("title")) }
    var body by remember(id) { mutableStateOf(initial.optString("body")) }
    var dirty by remember(id) { mutableStateOf(false) }
    var field by remember(id) { mutableStateOf(TextFieldValue(initial.optString("body"))) }
    // A note with something in it opens ready to read; a new one opens to write.
    var preview by remember(id) { mutableStateOf(initial.optString("body").isNotBlank()) }
    var uploading by remember { mutableStateOf<String?>(null) }
    val opener = rememberFileOpener(repo)
    fun edit(v: TextFieldValue) { field = v; if (v.text != body) { body = v.text; dirty = true } }
    // Typing: Enter on a list line starts the next item, like the desktop.
    fun type(v: TextFieldValue) {
        val old = field
        val at = v.selection.start - 1
        if (v.text.length == old.text.length + 1 && v.selection.collapsed && at >= 0 && v.text[at] == '\n' && v.text.removeRange(at, at + 1) == old.text) {
            Md.continueList(old.text, at)?.let { (t, pos) -> edit(TextFieldValue(t, TextRange(pos))); return }
        }
        edit(v)
    }
    // Pictures and files: uploaded to the Drive (the note's course folder, or
    // "Note attachments"), then a line in the note where the cursor is.
    fun attach(uris: List<android.net.Uri>) {
        if (uris.isEmpty()) return
        var left = uris.size
        uploading = if (left > 1) "Uploading $left files…" else "Uploading…"
        for (u in uris) repo.upload(u, null, live.str("course_id"), id) { f, err ->
            left--
            if (f != null) {
                val name = f.optString("name")
                val line = (if (f.optString("mime").startsWith("image/")) "![$name]" else "[$name]") + "(hgfile:${f.optString("id")})"
                val t = field.text
                val pos = if (preview) t.length else field.selection.max
                val before = if (pos > 0 && t[pos - 1] != '\n') "\n" else ""
                val ins = before + line + "\n"
                edit(TextFieldValue(t.substring(0, pos) + ins + t.substring(pos), TextRange(pos + ins.length)))
            }
            if (err != null) uploading = "Upload failed: $err" else if (left == 0) uploading = null
        }
    }
    val pickPictures = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { attach(it) }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { attach(it) }
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
    // Save: numbered lists counted again, saved now, shown formatted.
    fun saveAndView() {
        val tidy = Md.renumber(field.text)
        if (tidy != field.text) edit(TextFieldValue(tidy, TextRange(tidy.length)))
        save()
        preview = true
    }
    fun toggleTask(line: Int) {
        val t = Md.toggleTask(body, line)
        if (t != body) { edit(TextFieldValue(t)); save() }
    }
    DisposableEffect(id) { onDispose { save() } }

    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton({ save(); nav.pop() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back", tint = HColors.fg) }
            Grow()
            T(uploading ?: if (dirty) "Edited" else "Saved", 11, if (uploading != null) HColors.gold else HColors.faint)
            if (preview) IconButton({ preview = false }) { Icon(Icons.Outlined.Edit, "Edit", tint = HColors.fg) }
            else HButton("Save", Modifier.padding(horizontal = 4.dp), primary = true, icon = Icons.Outlined.Check) { saveAndView() }
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
        FileOpenerHost(opener)
        if (showVersions) VersionsDialog(versions, { showVersions = false }) { v ->
            showVersions = false
            nav.sheets.confirm = Triple("Restore this version?", "The note goes back to the text from ${stamp(v.optLong("saved_at"))}. What it says now is kept as a version too.") {
                repo.restoreVersion(v)
                title = v.optString("title"); body = v.optString("body"); field = TextFieldValue(body); dirty = false
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
            // Formatting and attachments, like the desktop's toolbar; only while editing.
            if (!preview) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                val tools = listOf(
                    Icons.Outlined.FormatBold to { edit(wrapSel(field, "**", "**")) },
                    Icons.Outlined.FormatItalic to { edit(wrapSel(field, "*", "*")) },
                    Icons.Outlined.FormatUnderlined to { edit(wrapSel(field, "<u>", "</u>")) },
                    Icons.Outlined.FormatStrikethrough to { edit(wrapSel(field, "~~", "~~")) },
                    Icons.Outlined.Title to { edit(prefixLines(field, "h")) },
                    Icons.Outlined.FormatListBulleted to { edit(prefixLines(field, "ul")) },
                    Icons.Outlined.FormatListNumbered to { edit(prefixLines(field, "ol")) },
                    Icons.Outlined.CheckBox to { edit(prefixLines(field, "todo")) },
                )
                for ((icon, act) in tools) IconButton({ act() }) { Icon(icon, null, tint = HColors.muted) }
                Box(Modifier.width(1.dp).height(24.dp).background(HColors.border))
                IconButton({ pickPictures.launch("image/*") }) { Icon(Icons.Outlined.Image, "Add pictures", tint = HColors.muted) }
                IconButton({ pickFiles.launch(arrayOf("*/*")) }) { Icon(Icons.Outlined.AttachFile, "Attach files", tint = HColors.muted) }
            }
            if (!preview) Box(Modifier.fillMaxWidth().height(1.dp).background(HColors.border))
            Spacer(Modifier.height(12.dp))
            if (preview) {
                NoteView(body.ifBlank { "*Nothing written yet. Tap the pencil to write.*" }, opener, Modifier.fillMaxSize().verticalScroll(rememberScrollState()), onToggleTask = { toggleTask(it) })
            } else BasicTextField(
                field, { type(it) }, Modifier.fillMaxSize(),
                textStyle = TextStyle(color = HColors.fg, fontFamily = Mono, fontSize = 15.sp, lineHeight = 22.sp),
                cursorBrush = SolidColor(HColors.accent),
                decorationBox = { inner -> if (body.isEmpty()) T("Write here. The toolbar formats it; pictures and files attach.", 15, HColors.faint); inner() },
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
