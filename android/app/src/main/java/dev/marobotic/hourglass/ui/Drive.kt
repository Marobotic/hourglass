package dev.marobotic.hourglass.ui

import android.content.ClipData
import android.content.ClipDescription
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.draganddrop.dragAndDropSource
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draganddrop.DragAndDropEvent
import androidx.compose.ui.draganddrop.DragAndDropTarget
import androidx.compose.ui.draganddrop.DragAndDropTransferData
import androidx.compose.ui.draganddrop.mimeTypes
import androidx.compose.ui.draganddrop.toAndroidDragEvent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.core.str
import dev.marobotic.hourglass.data.Repo
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.io.File

fun fmtBytes(n: Long): String = when {
    n < 1024 -> "$n B"
    n < 1024L * 1024 -> "%.0f KB".format(n / 1024.0)
    n < 1024L * 1024 * 1024 -> "%.1f MB".format(n / 1048576.0)
    else -> "%.1f GB".format(n / 1073741824.0)
}

// Open a downloaded Drive file in whatever app handles it.
fun openExternally(ctx: Context, file: File, mime: String) {
    val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", file)
    val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime.ifBlank { "*/*" })
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { ctx.startActivity(Intent.createChooser(i, file.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

// Tap a Drive file: pictures preview here, everything else opens in its own app.
class FileOpener(val repo: Repo, val ctx: Context) {
    var preview by mutableStateOf<Pair<JSONObject, ImageBitmap>?>(null)
    var busy by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)
    fun open(f: JSONObject) {
        busy = "Opening ${f.optString("name")}…"
        repo.download(f.id) { file, err ->
            busy = null
            if (file == null) { error = err ?: "Could not download it"; return@download }
            val mime = f.optString("mime")
            val bmp = if (mime.startsWith("image/")) runCatching { decodeScaled(file, 2048) }.getOrNull() else null
            if (bmp != null) preview = f to bmp else openExternally(ctx, file, mime)
        }
    }
}

fun decodeScaled(file: File, max: Int): ImageBitmap? {
    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, o)
    var s = 1
    while (o.outWidth / s > max || o.outHeight / s > max) s *= 2
    return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = s })?.asImageBitmap()
}

@Composable
fun rememberFileOpener(repo: Repo): FileOpener {
    val ctx = LocalContext.current
    return remember { FileOpener(repo, ctx) }
}

@Composable
fun FileOpenerHost(o: FileOpener) {
    o.preview?.let { (f, bmp) ->
        AlertDialog(
            onDismissRequest = { o.preview = null }, containerColor = HColors.surface, shape = RectangleShape,
            title = { T(f.optString("name"), 15, bold = true, maxLines = 2) },
            text = { Image(bmp, f.optString("name"), Modifier.fillMaxWidth().heightIn(max = 520.dp), contentScale = ContentScale.Fit) },
            confirmButton = { HButton("Close") { o.preview = null } },
            dismissButton = { HButton("Open in app") { val p = o.preview; o.preview = null; p?.let { (row, _) -> o.repo.driveCopy(row.id)?.let { openExternally(o.ctx, it, row.optString("mime")) } } } },
        )
    }
    o.error?.let { e ->
        AlertDialog(onDismissRequest = { o.error = null }, containerColor = HColors.surface, shape = RectangleShape,
            title = { T("Could not open it", 16, bold = true) }, text = { T(e, 13, HColors.muted) },
            confirmButton = { HButton("OK") { o.error = null } })
    }
}
// Send a Drive file itself to another app (Messages, Mail, WhatsApp…): the
// system share sheet, with the phone's copy (downloaded first if need be).
fun sendFile(ctx: Context, file: File, mime: String) {
    val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", file)
    val i = Intent(Intent.ACTION_SEND).setType(mime.ifBlank { "application/octet-stream" }).putExtra(Intent.EXTRA_STREAM, uri)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    runCatching { ctx.startActivity(Intent.createChooser(i, "Send ${file.name}").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

// Share a link as text (the share sheet: Messages, Mail, copy…).
fun sendText(ctx: Context, text: String, title: String) {
    val i = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    runCatching { ctx.startActivity(Intent.createChooser(i, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

// What is being dragged in the Drive: "file:<id>" or "folder:<id>", as the drag's text.
private const val DRAG_LABEL = "hourglass-drive"

// The Drive: every course has a folder for the files put there; then your own
// folders and files. Bytes live on the server; the rows sync to every device.
// Hold a file or folder, then drag it onto a folder (or onto the back arrow to
// take it up one level, or onto a course for a file) to move it there.
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DriveScreen(nav: Nav, version: Int) {
    val repo = nav.repo
    val ctx = LocalContext.current
    var folderId by rememberSaveable { mutableStateOf<String?>(null) }
    var courseId by rememberSaveable { mutableStateOf<String?>(null) }
    var bump by remember { mutableIntStateOf(0) } // a move made here: list again now
    val view = remember(version, folderId, courseId, bump) { repo.drive(folderId, courseId) }
    var usage by remember { mutableStateOf<JSONObject?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var naming by remember { mutableStateOf<Pair<String, (String) -> Unit>?>(null) }
    var moving by remember { mutableStateOf<Pair<String, JSONObject>?>(null) } // "files" | "folders" to the row
    var sharing by remember { mutableStateOf<Pair<String, JSONObject>?>(null) }
    var shares by remember { mutableStateOf<Map<String, JSONObject>>(emptyMap()) }
    val opener = rememberFileOpener(repo)
    fun loadShares() = repo.shares { list, _ -> if (list != null) shares = list.associateBy { it.optString("file_id").ifBlank { it.optString("folder_id") } } }
    // The server's disk barely moves: read it every minute (and the links with it).
    LaunchedEffect(Unit) { while (true) { loadShares(); repo.driveUsage { usage = it }; delay(60000) } }

    fun up() { if (courseId != null) courseId = null else folderId = view.path.dropLast(1).lastOrNull()?.id }
    BackHandler(enabled = folderId != null || courseId != null) { up() }

    // A dragged "file:<id>" / "folder:<id>" into a folder (null = the top) or a course.
    fun drop(what: String, intoFolder: String?, intoCourse: String? = null): Boolean {
        val (table, id) = what.split(":", limit = 2).let { it[0] to it.getOrElse(1) { "" } }
        when {
            table == "file" && intoCourse != null -> repo.setFileCourse(id, intoCourse)
            table == "file" -> repo.setFileFolder(id, intoFolder)
            table == "folder" && id == intoFolder -> return false
            table == "folder" -> if (!repo.moveFolder(id, intoFolder)) { status = "A folder can't go inside itself."; return false }
            else -> return false
        }
        status = null
        bump++
        return true
    }
    @Composable
    fun dropTarget(onDrop: (String) -> Boolean): Pair<Modifier, Boolean> {
        var over by remember { mutableStateOf(false) }
        val target = remember {
            object : DragAndDropTarget {
                override fun onEntered(event: DragAndDropEvent) { over = true }
                override fun onExited(event: DragAndDropEvent) { over = false }
                override fun onEnded(event: DragAndDropEvent) { over = false }
                override fun onDrop(event: DragAndDropEvent): Boolean {
                    over = false
                    val clip = event.toAndroidDragEvent().clipData ?: return false
                    if (clip.description?.label != DRAG_LABEL || clip.itemCount == 0) return false
                    return onDrop(clip.getItemAt(0).text?.toString() ?: return false)
                }
            }
        }
        return Modifier.dragAndDropTarget(shouldStartDragAndDrop = { e -> e.mimeTypes().contains(ClipDescription.MIMETYPE_TEXT_PLAIN) }, target = target) to over
    }

    // "Download…": the system's save picker (Downloads, Drive, any folder), then the copy.
    var saving by remember { mutableStateOf<JSONObject?>(null) }
    val saver = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val f = saving
        saving = null
        if (uri == null || f == null) return@rememberLauncherForActivityResult
        status = "Downloading ${f.optString("name")}…"
        repo.saveTo(f.id, uri) { err -> status = if (err != null) "Download failed: $err" else "Saved ${f.optString("name")}" }
    }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        // The upload panel shows each file going up.
        for (u in uris) repo.upload(u, folderId, courseId) { _, _ -> }
    }
    fun send(f: JSONObject) {
        status = "Getting ${f.optString("name")} ready…"
        repo.download(f.id) { file, err ->
            status = null
            if (file != null) sendFile(ctx, file, f.optString("mime")) else status = "Could not send it: ${err ?: "download failed"}"
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (folderId != null || courseId != null) {
                // Drop on the back arrow: one folder up.
                val (mod, over) = dropTarget { drop(it, view.path.dropLast(1).lastOrNull()?.id) }
                IconButton({ up() }, mod.background(if (over) HColors.accent.copy(alpha = 0.3f) else Color.Transparent)) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Up", tint = HColors.fg) }
            } else Spacer(Modifier.width(12.dp))
            T(view.course?.optString("name") ?: view.folder?.optString("name") ?: "Drive", 22, bold = true, maxLines = 1, modifier = Modifier.weight(1f))
            if (courseId == null) IconButton({ naming = "New folder" to { n: String -> if (n.isNotBlank()) repo.addFolder(n, folderId) } }) {
                Icon(Icons.Outlined.CreateNewFolder, "New folder", tint = HColors.muted)
            }
            IconButton({ pick.launch(arrayOf("*/*")) }) { Icon(Icons.Outlined.Upload, "Upload", tint = HColors.muted) }
        }
        // The server's disk, live.
        usage?.let { u ->
            val total = u.optLong("total").coerceAtLeast(1)
            val used = u.optLong("used")
            Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 4.dp)) {
                Box(Modifier.fillMaxWidth().height(4.dp).background(HColors.surface2)) {
                    Box(Modifier.fillMaxWidth((used.toFloat() / total).coerceIn(0f, 1f)).height(4.dp).background(HColors.teal))
                }
                Spacer(Modifier.height(4.dp))
                T("${fmtBytes(u.optLong("mine"))} yours  ·  ${fmtBytes(u.optLong("free"))} free of ${fmtBytes(total)}  ·  hold a file to drag it", 11, HColors.muted)
            }
        }
        (status ?: opener.busy)?.let { T(it, 12, HColors.gold, modifier = Modifier.padding(horizontal = 18.dp, vertical = 4.dp)) }
        val empty = view.courses.isEmpty() && view.folders.isEmpty() && view.files.isEmpty()
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) {
            if (empty) item { T(if (courseId != null) "Nothing in this course's folder yet. Upload files here, or attach them to its notes." else "Empty. Upload files or make a folder.", 13, HColors.faint, modifier = Modifier.padding(8.dp)) }
            items(view.courses, key = { "c" + it.first.id }) { (c, n) ->
                val (mod, over) = dropTarget { what -> what.startsWith("file:") && drop(what, null, c.id) }
                DriveRow(Icons.Outlined.School, c.optString("name"), "$n file" + if (n == 1) "" else "s", hex(c.optString("color")), modifier = mod, highlight = over) { courseId = c.id }
            }
            items(view.folders, key = { "d" + it.first.id }) { (d, n) ->
                val (mod, over) = dropTarget { drop(it, d.id) }
                DriveRow(Icons.Outlined.Folder, d.optString("name"), "$n item" + if (n == 1) "" else "s", HColors.gold, modifier = mod, highlight = over,
                    shared = shares.containsKey(d.id), dragAs = "folder:${d.id}", menu = listOf(
                        (if (shares.containsKey(d.id)) "Shared · link…" else "Share link…") to { sharing = "folders" to d },
                        "Move to…" to { moving = "folders" to d },
                        "Rename" to { naming = "Rename folder" to { s: String -> if (s.isNotBlank()) repo.renameDrive("folders", d.id, s) } },
                        "Delete" to { nav.sheets.confirm = Triple("Delete folder?", "\"${d.optString("name")}\" and everything in it will be removed from every device.") { repo.removeFolder(d.id) } },
                    )) { folderId = d.id }
            }
            items(view.files, key = { "f" + it.id }) { f ->
                val mime = f.optString("mime")
                val icon = if (mime.startsWith("image/")) Icons.Outlined.Image else if (mime.startsWith("video/")) Icons.Outlined.Movie else Icons.Outlined.Description
                DriveRow(icon, f.optString("name"), fmtBytes(f.optLong("size")), HColors.muted, shared = shares.containsKey(f.id), dragAs = "file:${f.id}", menu = buildList {
                    add("Open" to { opener.open(f) })
                    add("Send file…" to { send(f) })
                    add((if (shares.containsKey(f.id)) "Shared · link…" else "Share link…") to { sharing = "files" to f })
                    add("Download…" to { saving = f; saver.launch(f.optString("name").ifBlank { "file" }) })
                    add("Move to…" to { moving = "files" to f })
                    add("Rename" to { naming = "Rename file" to { s: String -> if (s.isNotBlank()) repo.renameDrive("files", f.id, s) } })
                    add("Delete" to { nav.sheets.confirm = Triple("Delete file?", "\"${f.optString("name")}\" will be removed from every device.") { repo.removeFile(f.id) } })
                }) { opener.open(f) }
            }
        }
    }
    naming?.let { (title, ok) -> NameDialog(title, { naming = null }) { ok(it); naming = null } }
    moving?.let { (table, row) ->
        MoveDialog(repo, table, row, { moving = null }) { into, course ->
            moving = null
            drop((if (table == "files") "file:" else "folder:") + row.id, into, course)
        }
    }
    sharing?.let { (table, row) ->
        ShareDialog(repo, table, row, shares[row.id], { sharing = null; loadShares() }) { send(row) }
    }
    FileOpenerHost(opener)
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DriveRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector, name: String, detail: String, tint: Color,
    modifier: Modifier = Modifier, highlight: Boolean = false, shared: Boolean = false, dragAs: String? = null,
    menu: List<Pair<String, () -> Unit>> = emptyList(), onClick: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    // Tap opens; hold starts a drag (the row's "file:<id>" / "folder:<id>").
    val press = if (dragAs != null) Modifier.dragAndDropSource {
        detectTapGestures(
            onTap = { onClick() },
            onLongPress = { startTransfer(DragAndDropTransferData(ClipData.newPlainText(DRAG_LABEL, dragAs))) },
        )
    } else Modifier.clickable(onClick = onClick)
    Row(
        modifier.fillMaxWidth().background(if (highlight) HColors.accent.copy(alpha = 0.25f) else Color.Transparent).then(press).padding(horizontal = 6.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            T(name, 15, maxLines = 1)
            T(detail, 12, HColors.muted)
        }
        if (shared) Icon(Icons.Outlined.Link, "Shared by link", tint = HColors.teal, modifier = Modifier.size(18.dp))
        if (menu.isNotEmpty()) Box {
            IconButton({ open = true }) { Icon(Icons.Outlined.MoreVert, "More", tint = HColors.muted) }
            DropdownMenu(open, { open = false }, containerColor = HColors.surface) {
                for ((label, act) in menu) DropdownMenuItem(text = { T(label, 14, if (label == "Delete") HColors.accent else HColors.fg) }, onClick = { open = false; act() })
            }
        }
    }
}

// "Move to…": every folder (by its path), the top, and for a file the courses.
@Composable
private fun MoveDialog(repo: Repo, table: String, row: JSONObject, onDismiss: () -> Unit, onPick: (String?, String?) -> Unit) {
    val all = remember { repo.folders() }
    val byId = remember(all) { all.associateBy { it.id } }
    fun pathOf(f: JSONObject): String {
        val names = mutableListOf<String>()
        var x: JSONObject? = f
        var n = 0
        while (x != null && n++ < 20) { names.add(0, x.optString("name")); x = x.str("parent_id")?.let { byId[it] } }
        return names.joinToString(" / ")
    }
    fun inside(f: JSONObject): Boolean {
        var x: JSONObject? = f
        var n = 0
        while (x != null && n++ < 20) { if (x.id == row.id) return true; x = x.str("parent_id")?.let { byId[it] } }
        return false
    }
    val here = if (table == "folders") row.str("parent_id") else row.str("folder_id")
    val choices = all.filter { !(table == "folders" && inside(it)) }.map { it.id to pathOf(it) }.sortedBy { it.second.lowercase() }
    val courses = if (table == "files") repo.courses() else emptyList()
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = HColors.surface, shape = RectangleShape,
        title = { T("Move ${row.optString("name")}", 16, bold = true, maxLines = 2) },
        text = {
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                item { MoveChoice("Top of the Drive", here == null && row.str("course_id") == null) { onPick(null, null) } }
                items(choices, key = { it.first }) { (id, path) -> MoveChoice(path, here == id) { onPick(id, null) } }
                if (courses.isNotEmpty()) item { T("COURSES", 11, HColors.muted, bold = true, spacing = 1.5, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp)) }
                items(courses, key = { "c" + it.id }) { c -> MoveChoice(c.optString("name"), row.str("course_id") == c.id) { onPick(null, c.id) } }
            }
        },
        confirmButton = { HButton("Cancel", onClick = onDismiss) },
    )
}

@Composable
private fun MoveChoice(label: String, current: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(enabled = !current, onClick = onClick).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Folder, null, tint = if (current) HColors.faint else HColors.gold, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        T(label + if (current) "  (here now)" else "", 14, if (current) HColors.faint else HColors.fg, maxLines = 2)
    }
}

// "Share link…": anyone with the link can view (or view and download) in a
// browser, no account needed. Same link when the access changes; "Stop
// sharing" turns it off. "Send file" sends the file itself instead.
@Composable
private fun ShareDialog(repo: Repo, table: String, row: JSONObject, existing: JSONObject?, onDismiss: () -> Unit, onSendFile: () -> Unit) {
    val ctx = LocalContext.current
    var link by remember { mutableStateOf(existing) }
    var access by remember { mutableStateOf(existing?.optString("access")?.ifBlank { null } ?: "view") }
    var days by remember { mutableIntStateOf(0) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    fun make() {
        busy = true
        repo.share(row.id.takeIf { table == "files" }, row.id.takeIf { table == "folders" }, access, days) { s, err ->
            busy = false
            if (s == null) { note = err; return@share }
            link = s
            clipboard.setText(androidx.compose.ui.text.AnnotatedString(s.optString("url")))
            note = "Link copied."
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = HColors.surface, shape = RectangleShape,
        title = { T("Share ${row.optString("name")}", 16, bold = true, maxLines = 2) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                T("Anyone with the link can open it in a browser, no account needed.", 13, HColors.muted)
                T("WHO CAN SEE IT", 11, HColors.muted, bold = true, spacing = 1.5)
                for ((k, label) in listOf("view" to "Anyone with the link can view", "download" to "…can view and download")) {
                    Row(Modifier.fillMaxWidth().clickable { access = k }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.material3.RadioButton(access == k, { access = k }, colors = androidx.compose.material3.RadioButtonDefaults.colors(selectedColor = HColors.accent))
                        T(label, 14)
                    }
                }
                T("THE LINK STOPS WORKING", 11, HColors.muted, bold = true, spacing = 1.5)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for ((d, label) in listOf(0 to "Never", 1 to "1 day", 7 to "7 days", 30 to "30 days")) {
                        T(label, 13, if (days == d) HColors.fg else HColors.muted, bold = days == d, modifier = Modifier
                            .background(if (days == d) HColors.surface2 else Color.Transparent).clickable { days = d }.padding(horizontal = 10.dp, vertical = 6.dp))
                    }
                }
                link?.let { l ->
                    T(l.optString("url"), 13, HColors.fg, modifier = Modifier.fillMaxWidth().background(HColors.bg).padding(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        HButton("Copy", icon = Icons.Outlined.Link) { clipboard.setText(androidx.compose.ui.text.AnnotatedString(l.optString("url"))); note = "Link copied." }
                        HButton("Share link", icon = Icons.Outlined.Share) { sendText(ctx, l.optString("url"), "Share the link") }
                    }
                    T("Now: anyone with the link can " + (if (l.optString("access") == "download") "view and download" else "view") +
                        (if (table == "folders") ". Everything in the folder is included." else "."), 12, HColors.muted)
                }
                note?.let { T(it, 12, HColors.accent) }
                if (table == "files") HButton("Send the file itself…", icon = Icons.Outlined.Share) { onDismiss(); onSendFile() }
            }
        },
        confirmButton = { HButton(if (link != null) "Save and copy" else "Create link", primary = true, enabled = !busy) { make() } },
        dismissButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                link?.let { l -> HButton("Stop sharing", danger = true) { repo.unshare(l.optString("token")) { err -> if (err != null) note = err else { link = null; note = "Sharing stopped: the link no longer opens anything." } } } }
                HButton("Close", onClick = onDismiss)
            }
        },
    )
}

@Composable
private fun NameDialog(title: String, onDismiss: () -> Unit, onOk: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = HColors.surface, shape = RectangleShape,
        title = { T(title, 16, bold = true) },
        text = { Field(text, { text = it }, "NAME", Modifier.fillMaxWidth()) },
        confirmButton = { HButton("Save", primary = true) { onOk(text) } },
        dismissButton = { HButton("Cancel", onClick = onDismiss) },
    )
}
