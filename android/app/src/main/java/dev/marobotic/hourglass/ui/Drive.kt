package dev.marobotic.hourglass.ui

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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

// The Drive: every course has a folder for the files put there; then your own
// folders and files. Bytes live on the server; the rows sync to every device.
@Composable
fun DriveScreen(nav: Nav, version: Int) {
    val repo = nav.repo
    var folderId by rememberSaveable { mutableStateOf<String?>(null) }
    var courseId by rememberSaveable { mutableStateOf<String?>(null) }
    val view = remember(version, folderId, courseId) { repo.drive(folderId, courseId) }
    var usage by remember { mutableStateOf<JSONObject?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var naming by remember { mutableStateOf<Pair<String, (String) -> Unit>?>(null) }
    val opener = rememberFileOpener(repo)
    LaunchedEffect(Unit) { while (true) { repo.driveUsage { usage = it }; delay(5000) } }

    fun up() { if (courseId != null) courseId = null else folderId = view.path.dropLast(1).lastOrNull()?.id }
    BackHandler(enabled = folderId != null || courseId != null) { up() }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        var left = uris.size
        status = if (left > 1) "Uploading $left files…" else "Uploading…"
        for (u in uris) repo.upload(u, folderId, courseId) { _, err ->
            left--
            if (err != null) status = "Upload failed: $err"
            else if (left == 0) status = null
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (folderId != null || courseId != null) IconButton({ up() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Up", tint = HColors.fg) }
            else Spacer(Modifier.width(12.dp))
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
                T("${fmtBytes(u.optLong("mine"))} yours  ·  ${fmtBytes(u.optLong("free"))} free of ${fmtBytes(total)}", 11, HColors.muted)
            }
        }
        (status ?: opener.busy)?.let { T(it, 12, HColors.gold, modifier = Modifier.padding(horizontal = 18.dp, vertical = 4.dp)) }
        val empty = view.courses.isEmpty() && view.folders.isEmpty() && view.files.isEmpty()
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) {
            if (empty) item { T(if (courseId != null) "Nothing in this course's folder yet. Upload files here, or attach them to its notes." else "Empty. Upload files or make a folder.", 13, HColors.faint, modifier = Modifier.padding(8.dp)) }
            items(view.courses, key = { "c" + it.first.id }) { (c, n) ->
                DriveRow(Icons.Outlined.School, c.optString("name"), "$n file" + if (n == 1) "" else "s", hex(c.optString("color"))) { courseId = c.id }
            }
            items(view.folders, key = { "d" + it.first.id }) { (d, n) ->
                DriveRow(Icons.Outlined.Folder, d.optString("name"), "$n item" + if (n == 1) "" else "s", HColors.gold, menu = listOf(
                    "Rename" to { naming = "Rename folder" to { s: String -> if (s.isNotBlank()) repo.renameDrive("folders", d.id, s) } },
                    "Delete" to { nav.sheets.confirm = Triple("Delete folder?", "\"${d.optString("name")}\" and everything in it will be removed from every device.") { repo.removeFolder(d.id) } },
                )) { folderId = d.id }
            }
            items(view.files, key = { "f" + it.id }) { f ->
                val mime = f.optString("mime")
                val icon = if (mime.startsWith("image/")) Icons.Outlined.Image else if (mime.startsWith("video/")) Icons.Outlined.Movie else Icons.Outlined.Description
                val courses = repo.courses()
                DriveRow(icon, f.optString("name"), fmtBytes(f.optLong("size")), HColors.muted, menu = buildList {
                    add("Open" to { opener.open(f) })
                    add("Rename" to { naming = "Rename file" to { s: String -> if (s.isNotBlank()) repo.renameDrive("files", f.id, s) } })
                    for (c in courses) if (c.id != f.str("course_id")) add("Put in ${c.optString("name")}" to { repo.setFileCourse(f.id, c.id) })
                    if (f.str("course_id") != null || f.str("folder_id") != null) add("Move to the top" to { repo.setFileFolder(f.id, null) })
                    add("Delete" to { nav.sheets.confirm = Triple("Delete file?", "\"${f.optString("name")}\" will be removed from every device.") { repo.removeFile(f.id) } })
                }) { opener.open(f) }
            }
        }
    }
    naming?.let { (title, ok) -> NameDialog(title, { naming = null }) { ok(it); naming = null } }
    FileOpenerHost(opener)
}

@Composable
private fun DriveRow(icon: androidx.compose.ui.graphics.vector.ImageVector, name: String, detail: String, tint: androidx.compose.ui.graphics.Color, menu: List<Pair<String, () -> Unit>> = emptyList(), onClick: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 6.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            T(name, 15, maxLines = 1)
            T(detail, 12, HColors.muted)
        }
        if (menu.isNotEmpty()) Box {
            IconButton({ open = true }) { Icon(Icons.Outlined.MoreVert, "More", tint = HColors.muted) }
            DropdownMenu(open, { open = false }, containerColor = HColors.surface) {
                for ((label, act) in menu) DropdownMenuItem(text = { T(label, 14, if (label == "Delete") HColors.accent else HColors.fg) }, onClick = { open = false; act() })
            }
        }
    }
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
