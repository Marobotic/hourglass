package dev.marobotic.hourglass.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.FormatBold
import androidx.compose.material.icons.outlined.FormatItalic
import androidx.compose.material.icons.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.FormatListNumbered
import androidx.compose.material.icons.outlined.FormatStrikethrough
import androidx.compose.material.icons.outlined.FormatUnderlined
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Title
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.NoteFormat
import dev.marobotic.hourglass.core.NoteLine
import dev.marobotic.hourglass.core.str
import kotlinx.coroutines.delay

// A note, written like a word processor: what you see is the note. Select
// text, then the toolbar: font, size, bold, italic, underline, strike,
// headings, lists, to-dos (tap a box to tick it), pictures and files (shown
// in place). Saves by itself 700 ms after the last change, and on the way out.
@Composable
fun NoteScreen(nav: Nav, id: String, version: Int) {
    val repo = nav.repo
    val initial = remember(id) { repo.store.get("notes", id) } ?: run { nav.pop(); return }
    val live = remember(version) { repo.store.get("notes", id) } ?: initial
    var title by remember(id) { mutableStateOf(initial.optString("title")) }
    val blocks = remember(id) { mutableStateListOf<NoteBlock>().apply { addAll(blocksOf(initial.optString("body"))) } }
    var focused by remember(id) { mutableStateOf((blocks.first { it is NoteBlock.Text } as NoteBlock.Text).rt) }
    var body by remember(id) { mutableStateOf(initial.optString("body")) }
    var dirty by remember(id) { mutableStateOf(false) }
    var tick by remember { mutableIntStateOf(0) } // the toolbar reads the format again
    var uploading by remember { mutableStateOf<String?>(null) }
    val opener = rememberFileOpener(repo)

    fun edited() {
        tick++
        val md = markdownOf(blocks)
        if (md != body) { body = md; dirty = true }
    }
    fun reload(md: String) {
        blocks.clear(); blocks.addAll(blocksOf(md))
        focused = (blocks.first { it is NoteBlock.Text } as NoteBlock.Text).rt
        body = md
    }

    // Pictures and files: uploaded to the Drive (the note's course folder, or
    // "Note attachments"), then shown in the note after the cursor's line.
    fun attach(uris: List<android.net.Uri>) {
        if (uris.isEmpty()) return
        var left = uris.size
        uploading = if (left > 1) "Uploading $left files…" else "Uploading…"
        for (u in uris) repo.upload(u, null, live.str("course_id"), id) { f, err ->
            left--
            if (f != null) {
                val line = NoteLine(if (f.optString("mime").startsWith("image/")) "image" else "file", fileId = f.optString("id"), fileName = f.optString("name"))
                val at = blocks.indexOfFirst { it is NoteBlock.Text && it.rt === focused }.let { if (it < 0) blocks.size - 1 else it }
                val rest = focused.splitAfterCursorLine()
                blocks.add(at + 1, NoteBlock.File(line))
                blocks.add(at + 2, NoteBlock.Text(rest ?: RichText()))
                edited()
            }
            if (err != null) uploading = "Upload failed: $err" else if (left == 0) uploading = null
        }
    }
    fun removeFile(n: Int) {
        blocks.removeAt(n)
        // Two stretches of text that now touch become one.
        val a = blocks.getOrNull(n - 1); val b = blocks.getOrNull(n)
        if (a is NoteBlock.Text && b is NoteBlock.Text) {
            val lines = (if (a.rt.text.isEmpty()) emptyList() else a.rt.toLines()) + (if (b.rt.text.isEmpty()) emptyList() else b.rt.toLines())
            blocks[n - 1] = NoteBlock.Text(RichText.fromLines(lines))
            blocks.removeAt(n)
        }
        edited()
    }
    val pickPictures = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { attach(it) }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { attach(it) }
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
            T(uploading ?: if (dirty) "Edited" else "Saved", 11, if (uploading != null) HColors.gold else HColors.faint)
            IconButton({ repo.updateNote(id, mapOf("pinned" to if (live.optInt("pinned") == 1) 0 else 1)) }) {
                Icon(Icons.Outlined.PushPin, "Pin", tint = if (live.optInt("pinned") == 1) HColors.gold else HColors.muted)
            }
            IconButton({
                nav.sheets.confirm = Triple("Delete note?", "\"${title.ifBlank { "Untitled" }}\" will be removed from every device.") { dirty = false; repo.deleteNote(id); nav.pop() }
            }) { Icon(Icons.Outlined.Delete, "Delete", tint = HColors.muted) }
            Box {
                IconButton({ menu = true }) { Icon(Icons.Outlined.MoreVert, "More", tint = HColors.muted) }
                DropdownMenu(menu, { menu = false }, containerColor = HColors.surface) {
                    DropdownMenuItem(
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
                title = v.optString("title"); reload(v.optString("body")); dirty = false
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
                        .background(if (on) HColors.surface2 else Color.Transparent)
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
            NoteToolbar(focused, tick, { edited() }, onPicture = { pickPictures.launch("image/*") }, onFile = { pickFiles.launch(arrayOf("*/*")) })
            Box(Modifier.fillMaxWidth().height(1.dp).background(HColors.border))
            Spacer(Modifier.height(10.dp))
            RichNoteBody(
                blocks, repo, opener,
                onEdited = { edited() },
                onFocused = { focused = it; tick++ },
                onRemoveFile = { removeFile(it) },
                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 40.dp),
            )
        }
    }
}

// The toolbar works on the selection of the text last touched (or on what is typed next).
@Composable
private fun NoteToolbar(rt: RichText, tick: Int, onEdited: () -> Unit, onPicture: () -> Unit, onFile: () -> Unit) {
    val here = remember(rt, tick, rt.value.selection, rt.pending) { rt.here() }
    var fontMenu by remember { mutableStateOf(false) }
    var sizeMenu by remember { mutableStateOf(false) }
    fun act(f: () -> Unit) { f(); onEdited() }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Box {
            Row(Modifier.padding(end = 4.dp).border(1.dp, HColors.border).clickable { fontMenu = true }.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.material3.Text(here.font ?: NoteFormat.FONTS[0], color = HColors.fg, fontSize = 13.sp, fontFamily = NoteFonts.of(here.font), maxLines = 1)
            }
            DropdownMenu(fontMenu, { fontMenu = false }, containerColor = HColors.surface) {
                for (f in NoteFormat.FONTS) DropdownMenuItem(
                    text = { androidx.compose.material3.Text(f, color = HColors.fg, fontSize = 17.sp, fontFamily = NoteFonts.of(f)) },
                    onClick = { fontMenu = false; act { rt.setFont(f) } },
                )
            }
        }
        Box {
            Row(Modifier.padding(end = 4.dp).border(1.dp, HColors.border).clickable { sizeMenu = true }.padding(horizontal = 10.dp, vertical = 6.dp)) {
                T("${here.size ?: NoteFormat.DEFAULT_SIZE}", 13)
            }
            DropdownMenu(sizeMenu, { sizeMenu = false }, containerColor = HColors.surface) {
                for (z in NoteFormat.SIZES) DropdownMenuItem(text = { T("$z", 15) }, onClick = { sizeMenu = false; act { rt.setSize(z) } })
            }
        }
        @Composable fun Tool(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, on: Boolean = false, f: () -> Unit) =
            IconButton({ act(f) }, Modifier.background(if (on) HColors.surface2 else Color.Transparent)) { Icon(icon, label, tint = if (on) HColors.fg else HColors.muted) }
        Tool(Icons.Outlined.FormatBold, "Bold", here.b) { rt.toggle("b") }
        Tool(Icons.Outlined.FormatItalic, "Italic", here.i) { rt.toggle("i") }
        Tool(Icons.Outlined.FormatUnderlined, "Underline", here.u) { rt.toggle("u") }
        Tool(Icons.Outlined.FormatStrikethrough, "Strike through", here.s) { rt.toggle("s") }
        Tool(Icons.Outlined.Title, "Heading") { rt.setHeading(2) }
        Tool(Icons.Outlined.FormatListBulleted, "Bullet list") { rt.setList("ul") }
        Tool(Icons.Outlined.FormatListNumbered, "Numbered list") { rt.setList("ol") }
        Tool(Icons.Outlined.CheckBox, "To-do list") { rt.setList("todo") }
        Box(Modifier.width(1.dp).height(24.dp).background(HColors.border))
        IconButton(onPicture) { Icon(Icons.Outlined.Image, "Add pictures", tint = HColors.muted) }
        IconButton(onFile) { Icon(Icons.Outlined.AttachFile, "Attach files", tint = HColors.muted) }
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
                        T(NoteFormat.preview(v.optString("body")).ifBlank { "(empty)" }, 13, HColors.fg.copy(alpha = 0.8f), maxLines = 3)
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(HColors.border))
                }
            }
        },
        confirmButton = { HButton("Close", onClick = onDismiss) },
    )
}
