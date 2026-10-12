package dev.marobotic.hourglass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.json.JSONObject
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image

private val SUGGESTIONS = listOf("What's on today?", "Set an alarm in 30 minutes", "Wake me at 7:30 on weekdays", "Start a 25 minute timer", "Tidy up my latest note")

// A picture or file for the next message: uploading, then its Drive id.
private data class Attachment(val key: Long, val name: String, val mime: String, val id: String? = null, val error: String? = null)

// Talk to Hourglass: the assistant runs on the server (opencode) and works on
// this account's notes, schedule, alarms and timers. Each tool it uses shows as
// a line ("Set an alarm"); when it finishes, the phone syncs the changes in.
// Common requests (an alarm, a timer, a birthday) come back at once: the
// server answers those itself. The paperclip attaches pictures and files (they
// go to the Drive's "Assistant" folder).
@Composable
fun AssistantScreen(nav: Nav) {
    val repo = nav.repo
    val opener = rememberFileOpener(repo)
    var chat by remember { mutableStateOf<JSONObject?>(null) }
    var pending by remember { mutableStateOf<String?>(null) }   // sent, not in the list yet
    var sending by remember { mutableStateOf(false) }
    var wasBusy by remember { mutableStateOf(false) }
    var input by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    var attachments by remember { mutableStateOf<List<Attachment>>(emptyList()) }
    val uploading = attachments.any { it.id == null && it.error == null }
    val ctx = androidx.compose.ui.platform.LocalContext.current

    val serverBusy = chat?.optBoolean("busy") == true
    val busy = sending || serverBusy || pending != null
    val enabled = chat?.optBoolean("enabled", true) != false

    fun messages(o: JSONObject?): List<JSONObject> = o?.optJSONArray("messages")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } } ?: emptyList()
    val shown = messages(chat).let { list ->
        val p = pending
        if (p != null && list.none { it.optString("role") == "user" && it.optString("text") == p }) list + JSONObject().put("role", "user").put("text", p) else list
    }

    fun load() = repo.assistant("GET") { o, err ->
        if (o == null) { problem = err; return@assistant }
        problem = null
        chat = o
        if (pending != null && messages(o).any { it.optString("role") == "user" && it.optString("text") == pending }) pending = null
        val nowBusy = o.optBoolean("busy") || pending != null
        // Finished: pull what the assistant changed.
        if (wasBusy && !nowBusy) repo.syncNow()
        wasBusy = nowBusy
    }

    fun send(text: String) {
        val files = attachments.filter { it.id != null }
        val kept = attachments
        // With only files, the server says what the message is.
        val t = text.trim().ifEmpty { if (files.isEmpty()) "" else "(see the attached file" + (if (files.size > 1) "s)" else ")") }
        if (t.isEmpty() || busy || uploading || !enabled) return
        pending = t; sending = true; wasBusy = true; input = ""; attachments = emptyList()
        val body = JSONObject().put("text", t).put("files", org.json.JSONArray(files.map { it.id }))
        repo.assistant("POST", "/message", body) { o, err ->
            sending = false
            if (o == null) { pending = null; input = text; attachments = kept; problem = err } else load()
        }
    }

    // Picked pictures and files: uploaded to the Drive's "Assistant" folder now.
    fun attach(uris: List<android.net.Uri>) {
        if (uris.isEmpty()) return
        val added = uris.mapIndexed { n, u ->
            val name = ctx.contentResolver.query(u, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "file"
            Attachment(System.nanoTime() + n, name, ctx.contentResolver.getType(u) ?: "") to u
        }
        attachments = attachments + added.map { it.first }
        repo.assistantFolder { folder, err ->
            for ((a, u) in added) {
                if (folder == null) { attachments = attachments.map { if (it.key == a.key) it.copy(error = err ?: "Could not upload") else it }; continue }
                repo.upload(u, folder, null) { row, upErr ->
                    attachments = attachments.map { if (it.key == a.key) (if (row != null) it.copy(id = row.optString("id"), mime = row.optString("mime")) else it.copy(error = upErr ?: "Could not upload")) else it }
                }
            }
        }
    }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { attach(it) }

    // Poll quickly while it works, slowly otherwise.
    LaunchedEffect(busy) { while (true) { load(); delay(if (busy) 900 else 15000) } }

    val list = rememberLazyListState()
    LaunchedEffect(shown.size, busy) { if (shown.isNotEmpty()) list.animateScrollToItem(shown.size) }

    Column(Modifier.fillMaxSize().background(HColors.bg).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton({ nav.pop() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back", tint = HColors.fg) }
            T("Assistant", 18, bold = true)
            Grow()
            if (shown.isNotEmpty() && !busy) HButton("New chat", Modifier.padding(end = 8.dp)) {
                repo.assistant("POST", "/new") { _, _ -> pending = null; load() }
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (shown.isEmpty()) {
                Column(
                    Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    PixelLogo(5.dp)
                    T(if (enabled) "Ask Hourglass to do it for you" else chat?.optString("reason").orEmpty().ifBlank { "The assistant is not available." }, 17, bold = true, align = androidx.compose.ui.text.style.TextAlign.Center)
                    if (enabled) {
                        T("It can read and change your notes, schedule, alarms, timers and Drive.", 13, HColors.muted, align = androidx.compose.ui.text.style.TextAlign.Center)
                        Spacer(Modifier.height(4.dp))
                        for (s in SUGGESTIONS) HButton(s, Modifier.fillMaxWidth()) { send(s) }
                    }
                }
            } else LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), state = list, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                items(shown.size) { i -> Message(shown[i], opener) }
                item {
                    if (busy) T("Working…", 13, HColors.muted, modifier = Modifier.padding(start = 14.dp, bottom = 8.dp))
                    else Spacer(Modifier.height(4.dp))
                }
            }
        }

        problem?.let { T(it, 13, HColors.accent, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }

        // Attached, waiting to be sent
        if (attachments.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (a in attachments) FileChip(a.name, a.mime, if (a.error != null) a.error else if (a.id == null) "Uploading…" else null) { attachments = attachments.filter { it.key != a.key } }
        }

        // The message box
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Bottom) {
            IconButton({ pickFiles.launch(arrayOf("image/*", "*/*")) }, enabled = enabled && !busy) { Icon(Icons.Outlined.AttachFile, "Attach pictures or files", tint = HColors.muted) }
            BasicTextField(
                input, { input = it },
                Modifier.weight(1f).heightIn(min = 44.dp, max = 140.dp).border(1.dp, HColors.border).background(HColors.surface).padding(horizontal = 12.dp, vertical = 11.dp),
                enabled = enabled,
                textStyle = TextStyle(color = HColors.fg, fontFamily = Mono, fontSize = 15.sp, lineHeight = 21.sp),
                cursorBrush = SolidColor(HColors.accent),
                decorationBox = { inner -> if (input.isEmpty()) T(if (busy) "Working on it…" else "Ask Hourglass…", 15, HColors.faint); inner() },
            )
            Spacer(Modifier.width(8.dp))
            if (busy) HButton("", icon = Icons.Outlined.Stop) { repo.assistant("POST", "/stop") { _, _ -> load() } }
            else HButton("", primary = true, icon = Icons.AutoMirrored.Outlined.Send, enabled = enabled && (input.isNotBlank() || attachments.any { it.id != null }) && !uploading) { send(input) }
        }
    }
}

@Composable
private fun Message(m: JSONObject, opener: FileOpener) {
    val mine = m.optString("role") == "user"
    val text = m.optString("text")
    if (mine) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val files = m.optJSONArray("files")
            if (files != null) for (i in 0 until files.length()) {
                val f = files.getJSONObject(i)
                FileChip(f.optString("name"), f.optString("mime"), null, onClick = { opener.repo.store.get("files", f.optString("id"))?.let { opener.open(it) } })
            }
            T(text, 15, modifier = Modifier.widthIn(max = 300.dp).border(1.dp, HColors.border).background(HColors.surface2).padding(horizontal = 14.dp, vertical = 10.dp))
        }
        return
    }
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(HColors.accent))
        Column(Modifier.padding(start = 12.dp, top = 4.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val tools = m.optJSONArray("tools")
            if (tools != null) for (i in 0 until tools.length()) {
                val t = tools.getJSONObject(i)
                val status = t.optString("status")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        when (status) { "completed" -> Icons.Outlined.Check; "error" -> Icons.Outlined.Close; else -> Icons.Outlined.Sync },
                        null, Modifier.size(14.dp),
                        tint = when (status) { "completed" -> HColors.teal; "error" -> HColors.accent; else -> HColors.muted },
                    )
                    Spacer(Modifier.width(8.dp))
                    T(t.optString("label"), 13, HColors.muted)
                }
            }
            if (text.isNotBlank()) NoteView(text, opener)
            m.optString("error").takeIf { it.isNotBlank() && it != "null" }?.let { T(it, 13, HColors.accent) }
        }
    }
}

// A file on a message or waiting to be sent: its kind, its name, and a note
// ("Uploading…", an error). onRemove: an x to take it off; onClick: open it.
@Composable
private fun FileChip(name: String, mime: String, note: String?, onClick: (() -> Unit)? = null, onRemove: (() -> Unit)? = null) {
    Row(
        Modifier.widthIn(max = 260.dp).border(1.dp, if (note != null && note != "Uploading…") HColors.accent else HColors.border).background(HColors.surface2)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(start = 10.dp, end = if (onRemove != null) 0.dp else 10.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (mime.startsWith("image/")) Icons.Outlined.Image else Icons.Outlined.Description, null, tint = HColors.muted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f, fill = false)) {
            T(name, 13, maxLines = 1)
            if (note != null) T(note, 11, if (note == "Uploading…") HColors.muted else HColors.accent, maxLines = 1)
        }
        if (onRemove != null) IconButton(onRemove, Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Remove", tint = HColors.muted, modifier = Modifier.size(14.dp)) }
    }
}

@Composable
private fun FileChip(name: String, mime: String, note: String?, onRemove: () -> Unit) = FileChip(name, mime, note, null, onRemove)
