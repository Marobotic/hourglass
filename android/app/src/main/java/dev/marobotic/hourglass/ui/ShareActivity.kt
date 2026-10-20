package dev.marobotic.hourglass.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.StickyNote2
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.dp
import dev.marobotic.hourglass.App
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.core.str
import dev.marobotic.hourglass.data.Repo
import org.json.JSONObject

// What other apps share to Hourglass: files and pictures go to the Drive (pick
// a folder, then upload), text becomes a note. Opened from Android's share
// sheet; it closes itself when done, and "Open Hourglass" goes on to the app.
class ShareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val shared = Shared.from(intent, this)
        setContent { HourglassTheme { ShareScreen(App.repo(this), shared, onClose = { finish() }, onOpen = ::openApp) } }
    }

    private fun openApp(tab: String) {
        startActivity(Intent(this, MainActivity::class.java).putExtra("open_tab", tab).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
        finish()
    }
}

// The shared things: files (with their names and sizes) and/or text.
data class SharedFile(val uri: Uri, val name: String, val size: Long, val mime: String)
data class Shared(val files: List<SharedFile>, val text: String, val subject: String) {
    companion object {
        fun from(intent: Intent, act: ComponentActivity): Shared {
            val uris = mutableListOf<Uri>()
            @Suppress("DEPRECATION")
            when (intent.action) {
                Intent.ACTION_SEND -> (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM))?.let { uris.add(it) }
                Intent.ACTION_SEND_MULTIPLE -> (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM))?.let { uris.addAll(it) }
            }
            // Some apps put the file in ClipData only.
            if (uris.isEmpty()) intent.clipData?.let { c -> for (i in 0 until c.itemCount) c.getItemAt(i).uri?.let { uris.add(it) } }
            val files = uris.distinct().map { u ->
                var name = u.lastPathSegment ?: "file"
                var size = -1L
                runCatching {
                    act.contentResolver.query(u, null, null, null, null)?.use { c ->
                        if (c.moveToFirst()) {
                            c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = c.getString(it) ?: name }
                            c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !c.isNull(it) }?.let { size = c.getLong(it) }
                        }
                    }
                }
                SharedFile(u, name, size, act.contentResolver.getType(u) ?: intent.type ?: "application/octet-stream")
            }
            return Shared(
                files = files,
                text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim().orEmpty(),
                subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty(),
            )
        }
    }
}

@Composable
private fun ShareScreen(repo: Repo, shared: Shared, onClose: () -> Unit, onOpen: (String) -> Unit) {
    Column(Modifier.fillMaxSize().background(HColors.bg).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 6.dp, top = 10.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            PixelLogo(cell = 2.dp)
            Spacer(Modifier.width(12.dp))
            T(if (shared.files.isNotEmpty()) "Save to Drive" else "Save as a note", 18, bold = true)
            Spacer(Modifier.weight(1f))
            IconButton(onClose) { Icon(Icons.Outlined.Close, "Cancel", tint = HColors.muted) }
        }
        when {
            !repo.signedIn -> Message("Sign in to Hourglass first, then share again.", "Open Hourglass") { onOpen("drive") }
            shared.files.isNotEmpty() -> UploadFlow(repo, shared.files, onClose, onOpen)
            shared.text.isNotBlank() -> NoteFlow(repo, shared, onClose, onOpen)
            else -> Message("There was nothing to save in what was shared.", "Close", onClose)
        }
    }
}

@Composable
private fun Message(text: String, button: String, onClick: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        PixelLogo(cell = 5.dp)
        Spacer(Modifier.height(18.dp))
        T(text, 15, HColors.muted, align = androidx.compose.ui.text.style.TextAlign.Center)
        Spacer(Modifier.height(18.dp))
        HButton(button, primary = true, onClick = onClick)
    }
}

// --- files: pick a folder, upload ---

private sealed interface Place { data object Top : Place; data class Folder(val id: String) : Place; data class Course(val id: String) : Place }

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.UploadFlow(repo: Repo, files: List<SharedFile>, onClose: () -> Unit, onOpen: (String) -> Unit) {
    var place by remember { mutableStateOf<Place>(Place.Top) }
    var version by remember { mutableIntStateOf(0) }
    var naming by remember { mutableStateOf(false) }
    var phase by remember { mutableStateOf("pick") } // pick | uploading | done
    var current by remember { mutableIntStateOf(0) }
    val errors = remember { mutableListOf<String>() }

    val view = remember(place, version) {
        when (val p = place) {
            Place.Top -> repo.drive(null, null)
            is Place.Folder -> repo.drive(p.id, null)
            is Place.Course -> repo.drive(null, p.id)
        }
    }
    val placeName = when (place) { Place.Top -> "Drive"; is Place.Course -> view.course?.optString("name") ?: "Course"; is Place.Folder -> view.folder?.optString("name") ?: "Folder" }
    fun up() { place = when (val p = place) { is Place.Folder -> view.path.dropLast(1).lastOrNull()?.let { Place.Folder(it.id) } ?: Place.Top; else -> Place.Top } }
    BackHandler(enabled = phase == "pick" && place != Place.Top) { up() }

    fun uploadNext() {
        if (current >= files.size) { phase = "done"; return }
        val f = files[current]
        val (folder, course) = when (val p = place) { is Place.Folder -> p.id to null; is Place.Course -> null to p.id; Place.Top -> null to null }
        repo.upload(f.uri, folder, course) { _, err ->
            if (err != null) errors.add("${f.name}: $err")
            current++
            uploadNext()
        }
    }

    // What is being saved, always on top.
    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp)) {
        val total = files.sumOf { it.size.coerceAtLeast(0) }
        T(if (files.size == 1) files[0].name else "${files.size} files", 14, maxLines = 1)
        T((if (total > 0) fmtBytes(total) + "  ·  " else "") + "choose where they go", 12, HColors.muted)
    }

    AnimatedContent(phase, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(120)) }, label = "phase", modifier = Modifier.weight(1f)) { ph ->
        when (ph) {
            "pick" -> Column(Modifier.fillMaxSize()) {
                // Where we are: Drive / folder / folder, each part goes back there.
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (place != Place.Top) IconButton({ up() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back", tint = HColors.fg) }
                    Crumb("Drive", place == Place.Top) { place = Place.Top }
                    view.course?.let { c -> T("  /  ", 13, HColors.faint); Crumb(c.optString("name"), true) {} }
                    for (f in view.path) { T("  /  ", 13, HColors.faint); Crumb(f.optString("name"), f == view.path.last()) { place = Place.Folder(f.id) } }
                }
                AnimatedContent(place, transitionSpec = { (slideInHorizontally(tween(220)) { it / 6 } + fadeIn(tween(220))) togetherWith fadeOut(tween(100)) }, label = "folder", modifier = Modifier.weight(1f)) { _ ->
                    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
                        items(view.courses, key = { "c" + it.first.id }) { (c, n) ->
                            PickRow(Icons.Outlined.School, c.optString("name"), "$n file${if (n == 1) "" else "s"}", hex(c.str("color"))) { place = Place.Course(c.id) }
                        }
                        items(view.folders, key = { "f" + it.first.id }) { (f, n) ->
                            PickRow(Icons.Outlined.Folder, f.optString("name"), "$n item${if (n == 1) "" else "s"}", HColors.gold) { place = Place.Folder(f.id) }
                        }
                        items(view.files, key = { "x" + it.id }) { f ->
                            Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.Description, null, tint = HColors.faint, modifier = Modifier.size(20.dp))
                                Spacer(Modifier.width(14.dp))
                                T(f.optString("name"), 13, HColors.faint, maxLines = 1)
                            }
                        }
                        if (view.courses.isEmpty() && view.folders.isEmpty() && view.files.isEmpty()) item {
                            T("Empty. Upload here, or make a folder.", 13, HColors.faint, modifier = Modifier.padding(16.dp))
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().background(HColors.surface).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (place !is Place.Course) HButton("New folder", icon = Icons.Outlined.CreateNewFolder) { naming = true }
                    Spacer(Modifier.weight(1f))
                    HButton(if (files.size == 1) "Upload to $placeName" else "Upload ${files.size} to $placeName", primary = true) {
                        phase = "uploading"; current = 0; errors.clear(); uploadNext()
                    }
                }
            }
            "uploading" -> Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                PixelLogo(cell = 5.dp)
                Spacer(Modifier.height(20.dp))
                T("Uploading to $placeName", 16, bold = true)
                Spacer(Modifier.height(6.dp))
                T(if (current < files.size) "${current + 1} of ${files.size}  ·  ${files[current].name}" else "Finishing…", 13, HColors.muted, maxLines = 1)
                Spacer(Modifier.height(16.dp))
                val pct by animateFloatAsState(current.toFloat() / files.size, tween(400), label = "progress")
                Box(Modifier.fillMaxWidth().height(4.dp).background(HColors.surface2)) {
                    Box(Modifier.fillMaxWidth(pct.coerceIn(0.03f, 1f)).height(4.dp).background(HColors.accent))
                }
            }
            else -> Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                val ok = files.size - errors.size
                T(if (errors.isEmpty()) "Saved to $placeName" else "$ok of ${files.size} saved", 18, bold = true)
                Spacer(Modifier.height(8.dp))
                if (errors.isEmpty()) T("It's in your Drive on every device.", 13, HColors.muted)
                for (e in errors) T(e, 12, HColors.accent)
                Spacer(Modifier.height(20.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    HButton("Open Drive") { onOpen("drive") }
                    HButton("Done", primary = true, onClick = onClose)
                }
            }
        }
    }

    if (naming) FolderNameDialog(onDismiss = { naming = false }) { name ->
        naming = false
        val parent = (place as? Place.Folder)?.id
        val f = repo.addFolder(name, parent)
        repo.syncNow() // the server checks the folder exists before taking an upload into it
        version++
        place = Place.Folder(f.id)
    }
}

@Composable
private fun Crumb(text: String, current: Boolean, onClick: () -> Unit) {
    T(text, 14, if (current) HColors.fg else HColors.muted, bold = current, maxLines = 1, modifier = Modifier.clickable(enabled = !current, onClick = onClick).padding(vertical = 6.dp))
}

@Composable
private fun PickRow(icon: androidx.compose.ui.graphics.vector.ImageVector, name: String, detail: String, tint: Color, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 6.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            T(name, 15, maxLines = 1)
            T(detail, 12, HColors.muted)
        }
        T("›", 18, HColors.faint)
    }
}

@Composable
private fun FolderNameDialog(onDismiss: () -> Unit, onOk: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = HColors.surface, shape = RectangleShape,
        title = { T("New folder", 16, bold = true) },
        text = { Field(name, { name = it }, "Name") },
        confirmButton = { HButton("Make it", primary = true, enabled = name.isNotBlank()) { onOk(name.trim()) } },
        dismissButton = { HButton("Cancel", onClick = onDismiss) },
    )
}

// --- text: a note ---

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.NoteFlow(repo: Repo, shared: Shared, onClose: () -> Unit, onOpen: (String) -> Unit) {
    // A title from the subject (a page's title, an email's subject), else the first line.
    val firstLine = shared.text.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty()
    var title by remember { mutableStateOf(shared.subject.ifBlank { firstLine.take(60) }) }
    var body by remember { mutableStateOf(if (shared.subject.isBlank() && firstLine.length <= 60 && shared.text.lines().size > 1) shared.text.substringAfter(firstLine).trim() else shared.text) }
    var course by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf(false) }
    val courses = remember { repo.courses() }

    AnimatedContent(saved, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(120)) }, label = "note") { done ->
        if (done) Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.StickyNote2, null, tint = HColors.gold, modifier = Modifier.size(40.dp))
            Spacer(Modifier.height(12.dp))
            T("Saved to Notes", 18, bold = true)
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HButton("Open Notes") { onOpen("notes") }
                HButton("Done", primary = true, onClick = onClose)
            }
        } else Column(Modifier.fillMaxSize()) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 8.dp)) {
                Field(title, { title = it }, "Title")
                Spacer(Modifier.height(12.dp))
                Field(body, { body = it }, "Note", singleLine = false, modifier = Modifier.height(220.dp))
                if (courses.isNotEmpty()) {
                    Spacer(Modifier.height(16.dp))
                    T("COURSE", 11, HColors.muted, bold = true, spacing = 1.5)
                    Spacer(Modifier.height(8.dp))
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CoursePill("None", HColors.muted, course == null) { course = null }
                        for (c in courses) CoursePill(c.optString("name"), hex(c.str("color")), course == c.id) { course = c.id }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().background(HColors.surface).padding(12.dp)) {
                Spacer(Modifier.weight(1f))
                HButton("Save note", primary = true, enabled = body.isNotBlank() || title.isNotBlank()) {
                    repo.addNote(course, null, null, title.trim().ifBlank { null }, body.trim())
                    repo.syncNow()
                    saved = true
                }
            }
        }
    }
}

@Composable
private fun CoursePill(name: String, tint: Color, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.border(1.dp, if (on) tint else HColors.border, RectangleShape).background(if (on) tint.copy(alpha = 0.2f) else Color.Transparent)
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
    ) { T(name, 13, if (on) HColors.fg else HColors.muted, maxLines = 1) }
}
