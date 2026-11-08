package dev.marobotic.hourglass.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import dev.marobotic.hourglass.core.ChatMd
import dev.marobotic.hourglass.core.ChatStream
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableIntStateOf
import org.json.JSONArray
import org.json.JSONObject

private val SUGGESTIONS = listOf("What's on today?", "Remind me to call mom at 6pm", "Set my alarm in 1 hour", "Wake me at 7:30 on weekdays", "Start a 25 minute timer", "Upcoming birthdays", "Tidy up my latest note")

// A picture or file for the next message: uploading, then its Drive id.
private data class Attachment(val key: Long, val name: String, val mime: String, val id: String? = null, val error: String? = null)
private data class DriveEntry(val kind: String, val id: String, val name: String, val mime: String = "")

private val ASSISTANT_STATUS_WORDS = listOf("Simmering", "Tinkering", "Brewing", "Noodling", "Untangling", "Percolating", "Sketching", "Whittling", "Stirring", "Kneading", "Shaping", "Plotting", "Puzzling", "Polishing", "Wiring", "Weaving", "Mapping", "Mulling", "Sorting", "Mending", "Carving", "Measuring", "Sifting", "Riffing", "Fiddling", "Spinning", "Folding", "Juggling", "Tuning", "Tracing", "Layering", "Patching", "Marinating", "Hatching", "Shuffling", "Knitting", "Chiseling", "Doodling", "Arranging", "Mosaicking")
private fun pastAssistantStatus(word: String): String = mapOf("Simmering" to "Simmered", "Tinkering" to "Tinkered", "Brewing" to "Brewed", "Noodling" to "Noodled", "Untangling" to "Untangled", "Percolating" to "Percolated", "Sketching" to "Sketched", "Whittling" to "Whittled", "Stirring" to "Stirred", "Kneading" to "Kneaded", "Shaping" to "Shaped", "Plotting" to "Plotted", "Puzzling" to "Puzzled", "Polishing" to "Polished", "Wiring" to "Wired", "Weaving" to "Wove", "Mapping" to "Mapped", "Mulling" to "Mulled", "Sorting" to "Sorted", "Mending" to "Mended", "Carving" to "Carved", "Measuring" to "Measured", "Sifting" to "Sifted", "Riffing" to "Riffed", "Fiddling" to "Fiddled", "Spinning" to "Spun", "Folding" to "Folded", "Juggling" to "Juggled", "Tuning" to "Tuned", "Tracing" to "Traced", "Layering" to "Layered", "Patching" to "Patched", "Marinating" to "Marinated", "Hatching" to "Hatched", "Shuffling" to "Shuffled", "Knitting" to "Knitted", "Chiseling" to "Chiseled", "Doodling" to "Doodled", "Arranging" to "Arranged", "Mosaicking" to "Mosaicked")[word] ?: word
private fun assistantElapsed(ms: Long): String {
    val seconds = (ms / 1000).coerceAtLeast(0)
    return if (seconds >= 60) "${seconds / 60}m ${seconds % 60}s" else "${seconds}s"
}
private fun assistantToolVerb(tool: String): String = when {
    Regex("read|get|list", RegexOption.IGNORE_CASE).containsMatchIn(tool) -> "Reading"
    Regex("search|find", RegexOption.IGNORE_CASE).containsMatchIn(tool) -> "Searching"
    Regex("edit|write|move|add|update|set|remove|delete|restore", RegexOption.IGNORE_CASE).containsMatchIn(tool) -> "Editing"
    else -> "Running"
}

private fun JSONArray?.list(): List<JSONObject> = this?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } } ?: emptyList()

// "Free · big-pickle", "Claude plan · haiku 5.5", "API · gpt-5-mini" (as on the desktop).
private fun engineLabel(chat: JSONObject?): String = engineName(chat) + (chat?.takeIf { !it.isNull("effort") }?.optString("effort")?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: "")

private fun engineName(chat: JSONObject?): String {
    val m = chat?.optString("model").orEmpty()
    val short = m.removePrefix("opencode/").removePrefix("claude-").replace(Regex("-(\\d+)-(\\d+)$"), " $1.$2").replaceFirstChar { it.uppercase() }
    return when (chat?.optString("engine")) {
        "anthropic" -> "Claude API · $short"
        "claude" -> "Claude plan · $short"
        "openai" -> (chat?.optString("engine_name").orEmpty().ifBlank { "API" }) + " · " + m.ifBlank { "pick a model" }
        else -> "Free · " + short.ifBlank { "auto" }
    }
}

// Talk to Hourglass: the assistant runs on the server and works on this
// account's notes, schedule, alarms and timers. What it did shows as lines
// ("Set an alarm") and as cards (the alarm's clock, the timer's ring); its
// steps can be opened under each answer. Common requests come back at once
// (the server answers those itself). The paperclip attaches pictures and files.
@Composable
fun AssistantScreen(nav: Nav) {
    val repo = nav.repo
    val opener = rememberFileOpener(repo)
    var chat by remember { mutableStateOf<JSONObject?>(null) }
    var pending by remember { mutableStateOf<String?>(null) }   // sent, not in the list yet
    var sending by remember { mutableStateOf(false) }
    var wasBusy by remember { mutableStateOf(false) }
    var input by remember { mutableStateOf(repo.assistantDraft()) }   // kept per account
    var rev by remember { mutableIntStateOf(0) }                    // the live stream edits chat in place
    var live by remember { mutableStateOf(false) }                  // the event stream is connected
    var editing by remember { mutableStateOf<String?>(null) }       // the user message being rewritten
    var usageOpen by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var attachments by remember { mutableStateOf<List<Attachment>>(emptyList()) }
    var settingsOpen by remember { mutableStateOf(false) }
    var modelOpen by remember { mutableStateOf(false) }
    var modelSettings by remember { mutableStateOf<JSONObject?>(null) }
    var modelChoices by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var modelProblem by remember { mutableStateOf("") }
    var modelsLoading by remember { mutableStateOf(false) }
    var modelSaving by remember { mutableStateOf(false) }
    fun openModels() {
        modelOpen = true; modelsLoading = true; modelProblem = ""; modelChoices = emptyList(); modelSettings = null
        repo.assistant("GET", "/settings") { settings, err ->
            if (settings == null) { modelProblem = err ?: "Could not load models."; modelsLoading = false }
            else {
                modelSettings = settings
                val query = if (settings.optString("engine") == "openai") "?base_url=" + android.net.Uri.encode(settings.optString("base_url")) else "?engine=" + settings.optString("engine")
                repo.assistant("GET", "/models$query") { d, modelErr ->
                    modelChoices = d?.optJSONArray("models").list()
                    modelProblem = modelErr ?: d?.optString("error").orEmpty()
                    modelsLoading = false
                }
            }
        }
    }
    var driveOpen by remember { mutableStateOf(false) }
    var driveEntries by remember { mutableStateOf<List<DriveEntry>>(emptyList()) }
    var driveTitle by remember { mutableStateOf("Choose a Drive file") }
    var driveFolder by remember { mutableStateOf<String?>(null) }
    var driveCourse by remember { mutableStateOf<String?>(null) }
    var mode by remember { mutableStateOf("auto") }
    var showSteps by remember { mutableStateOf(false) }         // collapsed thinking signature
    var openSteps by remember { mutableStateOf(setOf<String>()) } // finished answers whose steps are shown
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var statusTurn by remember { mutableStateOf("") }
    var statusWord by remember { mutableStateOf(ASSISTANT_STATUS_WORDS.first()) }
    // Messages already on screen once: later ones rise in, these don't again.
    val seen = remember { mutableSetOf<String>() }
    var ready by remember { mutableStateOf(false) }
    val uploading = attachments.any { it.id == null && it.error == null }
    val ctx = androidx.compose.ui.platform.LocalContext.current

    @Suppress("UNUSED_VARIABLE") val tick = rev // the stream edits chat in place: reading rev redraws
    val serverBusy = chat?.optBoolean("busy") == true
    val direct = chat?.optString("engine").let { it == "anthropic" || it == "openai" }
    val queue = chat?.optJSONArray("queue").list()
    val quota = ChatStream.quota(chat)
    val context = ChatStream.context(chat)?.optDouble("context_percent")
    val busy = sending || serverBusy || pending != null
    val enabled = chat?.optBoolean("enabled", true) != false

    val messages = chat?.optJSONArray("messages").list()
    val shown = messages.let { list ->
        val p = pending
        if (p != null && list.none { it.optString("role") == "user" && it.optString("text") == p }) list + JSONObject().put("id", "pending").put("role", "user").put("text", p) else list
    }
    // The answer being worked on: its steps show live under Working.
    val current = if (serverBusy) messages.lastOrNull()?.takeIf { it.optString("role") == "assistant" } else null

    fun load() = repo.assistant("GET") { o, err ->
        if (o == null) { problem = err; return@assistant }
        problem = null
        if (chat?.toString() != o.toString()) chat = o
        mode = o.optString("mode", "auto").ifBlank { "auto" }
        if (pending != null && o.optJSONArray("messages").list().any { it.optString("role") == "user" && it.optString("text") == pending }) pending = null
        val nowBusy = o.optBoolean("busy") || pending != null
        // Finished: pull what the assistant changed.
        if (wasBusy && !nowBusy) repo.syncNow()
        wasBusy = nowBusy
    }

    // Saving a pick keeps the engine and base URL the settings already had.
    fun saveSetting(extra: JSONObject, done: () -> Unit) {
        val cfg = modelSettings ?: return
        val body = JSONObject().put("engine", cfg.optString("engine"))
        if (cfg.optString("engine") == "openai") body.put("base_url", cfg.optString("base_url"))
        for (k in extra.keys()) body.put(k, extra.get(k))
        modelSaving = true
        repo.assistant("POST", "/settings", body) { d, err ->
            modelSaving = false
            if (d != null) { modelSettings = JSONObject(cfg.toString()).also { n -> for (k in extra.keys()) n.put(k, extra.get(k)) }; done(); load() } else modelProblem = err ?: "Could not save."
        }
    }
    fun send(text: String) {
        val files = attachments.filter { it.id != null }
        val kept = attachments
        // With only files, the server says what the message is.
        val t = text.trim().ifEmpty { if (files.isEmpty()) "" else "(see the attached file" + (if (files.size > 1) "s)" else ")") }
        if (t.isEmpty() || sending || uploading || !enabled) return
        note = null
        val edit = editing
        if (edit != null) {
            // Everything after the message is dropped and it runs again.
            sending = true; wasBusy = true; input = ""; editing = null; attachments = emptyList()
            val body = JSONObject().put("message_id", edit).put("text", t)
            if (files.isNotEmpty()) body.put("files", JSONArray(files.map { it.id }))
            repo.assistant("POST", "/edit", body) { o, err ->
                sending = false
                if (o == null) { input = text; editing = edit; attachments = kept; problem = err } else load()
            }
            return
        }
        // While a reply runs the message waits its turn (or, on the direct engines, steers it).
        val waiting = serverBusy
        if (!waiting) { pending = t; wasBusy = true }
        sending = true; input = ""; attachments = emptyList()
        val body = JSONObject().put("text", t).put("files", JSONArray(files.map { it.id }))
        if (waiting && direct) body.put("steer", true)
        repo.assistant("POST", "/message", body) { o, err ->
            sending = false
            if (o == null) { pending = null; input = text; attachments = kept; problem = err } else load()
        }
    }
    fun retry(id: String) = repo.assistant("POST", "/retry", JSONObject().put("message_id", id)) { o, err -> if (o == null) problem = err else { note = null; wasBusy = true; load() } }
    fun undo() = repo.assistant("POST", "/undo") { o, err ->
        if (o == null) problem = err else { note = (if (o.optString("action") == "deleted") "Removed " else "Restored ") + o.optString("name"); load(); repo.syncNow() }
    }
    val lastUser = messages.lastOrNull { it.optString("role") == "user" }?.optString("id")
    val lastAnswer = messages.lastOrNull { it.optString("role") == "assistant" }?.optString("id")
    // Press and hold a message: copy it, quote it, and for the last turn retry, edit or undo.
    fun menuFor(m: JSONObject): List<Pair<String, () -> Unit>> {
        val id = m.optString("id")
        val text = m.optString("text")
        if (id == "pending") return emptyList()
        val mine = m.optString("role") == "user"
        return buildList {
            if (text.isNotBlank()) {
                add("Copy" to { copyText(ctx, ChatMd.plain(text)) })
                add("Copy as Markdown" to { copyText(ctx, text) })
                add("Quote in reply" to { input = ChatMd.quote(text) + input })
            }
            if (!busy) {
                if (mine && id == lastUser) add("Edit and resend" to { editing = id; input = text })
                if (!mine && id == lastAnswer) {
                    add("Retry" to { retry(id) })
                    if (m.optJSONArray("cards").list().any { it.optString("kind") == "file" && it.optString("state") in listOf("changed", "created") }) add("Undo file change" to { undo() })
                }
            }
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
    fun loadDrive(folderId: String?, courseId: String?) {
        driveFolder = folderId
        driveCourse = courseId
        val view = repo.drive(folderId, courseId)
        driveTitle = when {
            courseId != null -> "Course Drive"
            folderId != null -> view.folder?.optString("name").orEmpty().ifBlank { "Drive folder" }
            else -> "Choose a Drive file"
        }
        driveEntries = view.courses.map { (c, _) -> DriveEntry("course", c.optString("id"), c.optString("name")) } +
            view.folders.map { (f, _) -> DriveEntry("folder", f.optString("id"), f.optString("name")) } +
            view.files.map { f -> DriveEntry("file", f.optString("id"), f.optString("name"), f.optString("mime")) }
    }
    fun attachDriveFile(file: DriveEntry) {
        if (attachments.any { it.id == file.id }) return
        attachments = attachments + Attachment(System.nanoTime(), file.name, file.mime, file.id)
        driveOpen = false
    }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { attach(it) }

    // Poll quickly while it works, slowly otherwise; a clock for timers and "Working N s".
    LaunchedEffect(busy, live) { while (true) { load(); delay(if (live) 60000 else if (busy) 900 else 15000) } }
    // The live stream: text, tools, usage and state arrive as they happen.
    DisposableEffect(Unit) {
        val job = repo.assistantStream(
            // The stream does not replay: read the snapshot again after a reconnect.
            onLive = { on -> if (on != live) { live = on; if (on) load() } },
            onEvent = { ev, d ->
                if (ev == "state" && d.optBoolean("busy")) wasBusy = true
                val c = chat
                if (c == null || ChatStream.apply(c, ev, d) || (ev == "state" && !d.optBoolean("busy"))) load()
                rev++
            },
        )
        onDispose { job.cancel() }
    }
    // Drafts: kept a moment after typing, and when the screen closes.
    val latestInput by rememberUpdatedState(input)
    LaunchedEffect(input) { delay(400); repo.setAssistantDraft(input) }
    DisposableEffect(Unit) { onDispose { repo.setAssistantDraft(latestInput) } }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
    LaunchedEffect(current?.optString("id"), serverBusy) {
        if (serverBusy && current?.optString("id") != statusTurn) {
            statusTurn = current?.optString("id").orEmpty()
            statusWord = ASSISTANT_STATUS_WORDS.filter { it != statusWord }.randomOrNull() ?: "Simmering"
        }
    }
    LaunchedEffect(chat != null) { if (chat != null) { delay(50); seen.addAll(shown.map { it.optString("id") }); ready = true } }

    // Stay on the newest message while it grows, unless scrolled up to read.
    val list = rememberLazyListState()
    val atBottom by remember { derivedStateOf { val i = list.layoutInfo; i.visibleItemsInfo.lastOrNull()?.index?.let { it >= i.totalItemsCount - 2 } ?: true } }
    val lastKey = shown.lastOrNull()?.let { it.optString("id") + it.optString("text").length + it.optJSONArray("tools")?.length() + it.optJSONArray("cards")?.length() } + queue.size
    LaunchedEffect(lastKey, busy, current?.optJSONArray("steps")?.length()) {
        if (shown.isNotEmpty() && (atBottom || sending)) list.animateScrollToItem(shown.size)
    }

    if (settingsOpen) AssistantSettingsDialog(repo, onDismiss = { settingsOpen = false }, onSaved = { load() })
    if (driveOpen) {
        AlertDialog(
            onDismissRequest = { driveOpen = false },
            containerColor = HColors.surface,
            shape = RectangleShape,
            title = { Row(verticalAlignment = Alignment.CenterVertically) {
                if (driveFolder != null || driveCourse != null) IconButton({ loadDrive(null, null) }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Drive root", tint = HColors.fg) }
                T(driveTitle, 15, bold = true)
            } },
            text = {
                Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (driveEntries.isEmpty()) T("This folder is empty.", 13, HColors.muted, modifier = Modifier.padding(vertical = 16.dp))
                    for (entry in driveEntries) {
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                when (entry.kind) {
                                    "course" -> loadDrive(null, entry.id)
                                    "folder" -> loadDrive(entry.id, null)
                                    else -> attachDriveFile(entry)
                                }
                            }.padding(horizontal = 8.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(if (entry.kind == "file") Icons.Outlined.Description else Icons.Outlined.FolderOpen, null, tint = HColors.muted, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(10.dp))
                            T(entry.name, 13, modifier = Modifier.weight(1f), maxLines = 1)
                            T(if (entry.kind == "file") "ATTACH" else "OPEN", 10, HColors.accent, bold = true)
                        }
                    }
                }
            },
            confirmButton = { HButton("Close", onClick = { driveOpen = false }) },
        )
    }

    Column(Modifier.fillMaxSize().background(HColors.bg).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton({ nav.pop() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back", tint = HColors.fg) }
            T("Assistant", 18, bold = true)
            Grow()
            // Who answers: opens the AI settings.
            Row(Modifier.clickable { settingsOpen = true }.padding(horizontal = 8.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                T(engineLabel(chat), 12, HColors.muted, maxLines = 1, modifier = Modifier.widthIn(max = 160.dp))
                Icon(Icons.Outlined.ExpandMore, "Choose the AI", tint = HColors.muted, modifier = Modifier.size(16.dp))
            }
            if (shown.isNotEmpty() && !busy) HButton("New", Modifier.padding(end = 8.dp)) {
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
                items(shown, key = { it.optString("id").ifBlank { it.optString("text") } }) { m ->
                    val id = m.optString("id")
                    // The answer still being worked on, with nothing in it yet: the Working line shows instead.
                    val empty = m.optString("role") != "user" && m.optString("text").isBlank() && m.optJSONArray("tools").list().isEmpty() &&
                        m.optJSONArray("cards").list().isEmpty() && m.optString("error").let { it.isBlank() || it == "null" }
                    if (!empty) Rise(animate = ready && id !in seen, modifier = Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null)) {
                        seen.add(id)
                        Message(
                            m, opener, now,
                            stepsShown = id in openSteps,
                            canShowSteps = !(serverBusy && m == messages.lastOrNull()),
                            statusWord = statusWord,
                            menu = menuFor(m),
                            onAction = { actionId, action -> repo.assistantAction(actionId, action) { _, err -> if (err != null) problem = err else load() } },
                            onToggleSteps = { openSteps = if (id in openSteps) openSteps - id else openSteps + id },
                        )
                    }
                }
                item(key = "working") { Working(busy, current, now, showSteps, statusWord) { showSteps = !showSteps } }
                items(queue, key = { "q" + it.optString("id") }) { q ->
                    QueuedRow(q.optString("text"), q.optInt("files")) {
                        repo.assistant("DELETE", "/queue/" + android.net.Uri.encode(q.optString("id"))) { _, _ -> load() }
                    }
                }
            }
        }

        problem?.let { T(it, 13, HColors.accent, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
        note?.let { T(it, 12, HColors.muted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
        quota?.let { QuotaLine(it) }
        editing?.let {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                T("Editing your message: everything after it is replaced", 12, HColors.muted, modifier = Modifier.weight(1f))
                IconButton({ editing = null; input = "" }, Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Cancel editing", tint = HColors.muted, modifier = Modifier.size(16.dp)) }
            }
        }

        // Attached, waiting to be sent
        if (attachments.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (a in attachments) FileChip(a.name, a.mime, if (a.error != null) a.error else if (a.id == null) "Uploading…" else null) { attachments = attachments.filter { it.key != a.key } }
        }

        // The message box
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Bottom) {
            IconButton({ pickFiles.launch(arrayOf("image/*", "*/*")) }, enabled = enabled) { Icon(Icons.Outlined.AttachFile, "Attach pictures or files", tint = HColors.muted) }
            IconButton({ loadDrive(null, null); driveOpen = true }, enabled = enabled) { Icon(Icons.Outlined.FolderOpen, "Attach from Drive", tint = HColors.muted) }
            BasicTextField(
                input, { input = it },
                Modifier.weight(1f).heightIn(min = 44.dp, max = 140.dp).border(1.dp, HColors.border).background(HColors.surface).padding(horizontal = 12.dp, vertical = 11.dp),
                enabled = enabled,
                textStyle = TextStyle(color = HColors.fg, fontFamily = Mono, fontSize = 15.sp, lineHeight = 21.sp),
                cursorBrush = SolidColor(HColors.accent),
                decorationBox = { inner -> if (input.isEmpty()) T(if (serverBusy) "Queue another message…" else "Ask Hourglass…", 15, HColors.faint); inner() },
            )
            Spacer(Modifier.width(8.dp))
            if (busy && input.isBlank() && attachments.none { it.id != null }) HButton("", icon = Icons.Outlined.Stop) { repo.assistant("POST", "/stop") { _, _ -> load() } }
            else HButton("", primary = true, icon = Icons.AutoMirrored.Outlined.Send, enabled = enabled && !sending && (input.isNotBlank() || attachments.any { it.id != null }) && !uploading) { send(input) }
        }
        if (mode == "dangerous") T("Dangerous: changes and deletions apply without asking", 11, HColors.accent, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp))
        AssistantComposerChips(engineLabel(chat), mode, onModel = { openModels() }, onMode = { next ->
            repo.assistantMode(next) { saved, err -> if (saved != null) { mode = saved; load() } else problem = err }
        }, context = context, onContext = { usageOpen = true })
        if (usageOpen) UsageSheet(repo) { usageOpen = false }
        if (modelOpen) {
            val picked = modelSettings?.optString("model").orEmpty()
            val efforts = modelChoices.firstOrNull { it.optString("id") == picked }?.optJSONArray("efforts")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
            val effort = modelSettings?.takeIf { !it.isNull("effort") }?.optString("effort").orEmpty().ifBlank { chat?.takeIf { !it.isNull("effort") }?.optString("effort").orEmpty() }
            ModelSheet(
                engine = engineName(chat), selected = picked, choices = modelChoices, loading = modelsLoading, problem = modelProblem, saving = modelSaving,
                efforts = efforts, effort = effort,
                onEffort = { e -> saveSetting(JSONObject().put("model", picked).put("effort", e)) {} },
                onRefresh = { openModels() },
                onPick = { choice ->
                    val id = choice.optString("id")
                    val takesEffort = (choice.optJSONArray("efforts")?.length() ?: 0) > 0
                    saveSetting(JSONObject().put("model", id)) { if (!takesEffort) modelOpen = false }
                },
                onChangeAi = { modelOpen = false; settingsOpen = true },
                onDismiss = { modelOpen = false },
            )
        }
    }
}

@Composable
internal fun AssistantSnapshotScreen(repo: dev.marobotic.hourglass.data.Repo, variant: String) {
    val opener = rememberFileOpener(repo)
    val now = System.currentTimeMillis()
    val thinking = JSONArray().put(JSONObject().put("at", now - 4000).put("text", "Thinking: I am checking the next step."))
    val fileCards = JSONArray()
        .put(JSONObject().put("kind", "file").put("id", "read-file").put("label", "Schedule.md").put("state", "read").put("size", 2048).put("diff", JSONObject().put("added", 0).put("removed", 0)))
        .put(JSONObject().put("kind", "file").put("id", "changed-file").put("label", "Plan.md").put("state", "changed").put("size", 4096).put("diff", JSONObject().put("added", 2).put("removed", 1)))
        .put(JSONObject().put("kind", "file").put("id", "created-file").put("label", "Checklist.md").put("state", "created").put("size", 1024).put("diff", JSONObject().put("added", 6).put("removed", 0)))
    val action = JSONObject().put("id", "action-preview").put("status", "pending").put("summary", "Create alarm: Wake up at 7:30 AM on weekdays")
    val messages = when (variant) {
        "streaming" -> listOf(
            JSONObject().put("id", "user-stream").put("role", "user").put("text", "Review my schedule and tell me what to change."),
            JSONObject().put("id", "assistant-stream").put("role", "assistant").put("text", "").put("time", now - 4000).put("steps", thinking).put("tools", JSONArray()),
        )
        "pending" -> listOf(
            JSONObject().put("id", "user-pending").put("role", "user").put("text", "Wake me at 7:30 on weekdays."),
            JSONObject().put("id", "assistant-pending").put("role", "assistant").put("text", "I can set that alarm once you approve it.").put("pending_actions", JSONArray().put(action)),
        )
        "files" -> listOf(
            JSONObject().put("id", "user-files").put("role", "user").put("text", "Read these and make a checklist.").put("files", JSONArray().put(JSONObject().put("id", "schedule").put("name", "Schedule.md").put("mime", "text/markdown"))),
            JSONObject().put("id", "assistant-files").put("role", "assistant").put("text", "I read the schedule, updated the plan, and made a checklist.").put("cards", fileCards),
        )
        else -> emptyList()
    }
    Column(Modifier.fillMaxSize().background(HColors.bg).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            T("Assistant", 18, bold = true)
            Spacer(Modifier.weight(1f))
            if (variant != "empty") T("New chat", 11, HColors.muted)
        }
        if (variant == "empty") {
            Column(Modifier.weight(1f).fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                PixelLogo(5.dp)
                Spacer(Modifier.height(12.dp))
                T("Ask Hourglass to do it for you", 17, bold = true, align = androidx.compose.ui.text.style.TextAlign.Center)
                T("It can read and change your notes, schedule, alarms, timers and Drive.", 13, HColors.muted, align = androidx.compose.ui.text.style.TextAlign.Center)
            }
        } else {
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                messages.forEach { m ->
                    Message(m, opener, now, stepsShown = false, canShowSteps = true, statusWord = "Simmering", onAction = { _, _ -> }, onToggleSteps = {})
                }
                if (variant == "streaming") Working(true, messages.last(), now, false, "Simmering") {}
            }
        }
        if (variant == "dangerous") T("Dangerous: changes and deletions apply without asking", 11, HColors.accent, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp))
        Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).heightIn(min = 46.dp).border(1.dp, HColors.border).background(HColors.surface).padding(12.dp)) {
            T("Ask Hourglass…", 14, HColors.faint)
        }
        AssistantComposerChips("Claude plan · Haiku 5.5", if (variant == "dangerous") "dangerous" else "auto", onModel = {}, onMode = {})
    }
}

// A message new on screen rises in, once.
@Composable
private fun Rise(animate: Boolean, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val p = remember { Animatable(if (animate) 0f else 1f) }
    LaunchedEffect(Unit) { if (animate) p.animateTo(1f, tween(300, easing = FastOutSlowInEasing)) }
    Box(modifier.graphicsLayer { alpha = p.value; translationY = (1 - p.value) * 16.dp.toPx() }) { content() }
}

// While it works: three dots bouncing in turn, the seconds, and its steps live.
@Composable
private fun Working(busy: Boolean, current: JSONObject?, now: Long, showSteps: Boolean, statusWord: String, onToggle: () -> Unit) {
    AnimatedVisibility(busy, enter = fadeIn(tween(200)) + expandVertically(), exit = fadeOut(tween(150)) + shrinkVertically()) {
        Column(Modifier.padding(start = 14.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val t = rememberInfiniteTransition(label = "dots")
                val spin by t.animateFloat(0f, 360f, infiniteRepeatable(tween(1100, easing = LinearEasing)), label = "status-spin")
                Row(Modifier.height(14.dp), horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.Bottom) {
                    for (i in 0 until 3) {
                        val y by t.animateFloat(0f, 0f, infiniteRepeatable(keyframes {
                            durationMillis = 1200
                            0f at i * 140
                            -6f at i * 140 + 220
                            0f at i * 140 + 480
                        }, RepeatMode.Restart), label = "dot$i")
                        Box(Modifier.offset(y = y.dp).size(7.dp).clip(CircleShape).background(listOf(HColors.accent, HColors.orange, HColors.gold)[i]))
                    }
                }
                Spacer(Modifier.width(12.dp))
                val tools = current?.optJSONArray("tools").list()
                val running = tools.asReversed().firstOrNull { it.optString("status") == "running" }
                val status = when {
                    running != null -> "${assistantToolVerb(running.optString("tool"))}…"
                    !current?.optString("text").isNullOrBlank() -> "Writing…"
                    else -> "$statusWord…"
                }
                val elapsed = current?.optLong("time")?.takeIf { it > 0 }?.let { assistantElapsed(now - it) }.orEmpty()
                Icon(Icons.Outlined.Sync, null, Modifier.size(14.dp).rotate(spin), tint = HColors.accent)
                Spacer(Modifier.width(8.dp))
                T(status, 13, HColors.accent)
                if (elapsed.isNotBlank()) T(elapsed, 11, HColors.faint)
                if (current != null) {
                    Spacer(Modifier.width(12.dp))
                    T((if (showSteps) "▴" else "▾") + " What it's doing", 12, HColors.faint, modifier = Modifier.clickable(onClick = onToggle))
                }
            }
            if (showSteps && current != null) StepList(current.optJSONArray("steps").list())
        }
    }
}

@Composable
private fun Message(m: JSONObject, opener: FileOpener, now: Long, stepsShown: Boolean, canShowSteps: Boolean, statusWord: String, menu: List<Pair<String, () -> Unit>> = emptyList(), onAction: (String, String) -> Unit, onToggleSteps: () -> Unit) {
    val mine = m.optString("role") == "user"
    val text = m.optString("text")
    if (mine) {
        LongPressMenu(menu, Modifier.fillMaxWidth()) { Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (f in m.optJSONArray("files").list()) {
                FileChip(f.optString("name"), f.optString("mime"), null, onClick = { opener.repo.store.get("files", f.optString("id"))?.let { opener.open(it) } })
            }
            T(text, 15, modifier = Modifier.widthIn(max = 300.dp).border(1.dp, HColors.border).background(HColors.surface2).padding(horizontal = 14.dp, vertical = 10.dp))
        } }
        return
    }
    // The red bar on the left is drawn behind, not measured: a card with a lazy
    // or BoxWithConstraints layout (the day card) can't be measured intrinsically.
    LongPressMenu(menu, Modifier.fillMaxWidth()) { Row(Modifier.fillMaxWidth().drawBehind { drawRect(HColors.accent, size = androidx.compose.ui.geometry.Size(3.dp.toPx(), size.height)) }) {
        Column(Modifier.padding(start = 15.dp, top = 4.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            // What it did, one line per tool: a spinner, then a tick that pops in.
            for (t in m.optJSONArray("tools").list()) ToolRow(t)
            // What it did, drawn.
            for (a in m.optJSONArray("pending_actions").list()) PendingActionCard(a, onAction)
            for (f in m.optJSONArray("cards").list().filter { it.optString("kind") == "file" }) FileResultChip(f, opener)
            for (c in m.optJSONArray("cards").list().filter { it.optString("kind") !in listOf("action", "file") }) ResultCardView(c, now, Modifier.fillMaxWidth())
            if (text.isNotBlank()) NoteView(text, opener)
            m.optJSONObject("usage")?.let { u ->
                val parts = buildList {
                    if (!u.isNull("input_tokens") || !u.isNull("output_tokens")) add("${u.optLong("input_tokens")} in · ${u.optLong("output_tokens")} out")
                    val cached = u.optLong("cache_read_input_tokens") + u.optLong("cache_creation_input_tokens")
                    if (cached > 0) add("$cached cached")
                    if (!u.isNull("cost")) add("$" + "%.4f".format(u.optDouble("cost")))
                    if (!u.isNull("context_percent")) add("${"%.1f".format(u.optDouble("context_percent")).trimEnd('0').trimEnd('.')}% context")
                }
                if (parts.isNotEmpty()) T(parts.joinToString("  ·  "), 10, HColors.faint)
            }
            m.optString("error").takeIf { it.isNotBlank() && it != "null" }?.let { T(it, 13, HColors.accent) }
            // How it got there.
            val steps = m.optJSONArray("steps").list()
            if (steps.isNotEmpty() && canShowSteps) {
                val thinking = steps.filter { it.optString("text").startsWith("Thinking:") }.ifEmpty { steps }
                val span = if (thinking.size > 1) thinking.last().optLong("at") - thinking.first().optLong("at") else 0L
                val caption = pastAssistantStatus(statusWord) + if (span >= 1000) " for ${assistantElapsed(span)}" else ""
                Row(Modifier.clickable(onClick = onToggleSteps).padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    T(if (stepsShown) "Hide $caption" else "Show $caption", 11, HColors.faint)
                }
                AnimatedVisibility(stepsShown, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) { StepList(thinking) }
            }
        }
    } }
}

@Composable
private fun PendingActionCard(action: JSONObject, onAction: (String, String) -> Unit) {
    HCard(Modifier.fillMaxWidth(), stripe = if (action.optString("status") == "pending") HColors.accent else HColors.border) {
        T(action.optString("summary").ifBlank { "Action needs your approval" }, 12)
        Spacer(Modifier.height(8.dp))
        if (action.optString("status") == "pending") Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HButton("Apply", primary = true) { onAction(action.optString("id"), "apply") }
            HButton("Skip") { onAction(action.optString("id"), "skip") }
        } else T(action.optString("status").uppercase(), 10, HColors.muted, spacing = 1.0)
    }
}

@Composable
private fun FileResultChip(file: JSONObject, opener: FileOpener) {
    val state = file.optString("state").ifBlank { "changed" }.replaceFirstChar { it.uppercase() }
    val diff = file.optJSONObject("diff")
    val note = "$state · ${file.optLong("size")} bytes · +${diff?.optInt("added") ?: 0} / -${diff?.optInt("removed") ?: 0} lines"
    FileChip(file.optString("label").ifBlank { "Drive file" }, file.optString("mime"), note, onClick = {
        opener.repo.store.get("files", file.optString("id"))?.let { opener.open(it) }
    })
}

@Composable
private fun AssistantComposerChips(engine: String, mode: String, onModel: () -> Unit, onMode: (String) -> Unit, context: Double? = null, onContext: () -> Unit = {}) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.border(1.dp, HColors.border).background(HColors.surface2).clickable(onClick = onModel).padding(horizontal = 10.dp, vertical = 7.dp)) {
            T("$engine  ▾", 10, HColors.fg, maxLines = 1)
        }
        // Plan: it can look but not change anything.
        Box(
            Modifier.border(1.dp, if (mode == "plan") HColors.accent else HColors.border).background(if (mode == "plan") HColors.accent else HColors.surface2)
                .clickable { onMode(if (mode == "plan") "auto" else "plan") }.padding(horizontal = 10.dp, vertical = 7.dp),
        ) { T("Plan", 10, if (mode == "plan") HColors.bg else HColors.fg, bold = mode == "plan", maxLines = 1) }
        if (context != null && !context.isNaN()) ContextMeter(context, onContext)
        Box {
            Box(
                Modifier.border(1.dp, if (mode == "dangerous") HColors.accent else HColors.border)
                    .background(if (mode == "dangerous") HColors.accent else HColors.surface2)
                    .clickable { menu = true }.padding(horizontal = 10.dp, vertical = 7.dp),
            ) { T("${mode.replaceFirstChar { it.uppercase() }}  ▾", 10, if (mode == "dangerous") HColors.bg else HColors.fg, bold = mode == "dangerous", maxLines = 1) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = HColors.surface, shape = RectangleShape) {
                listOf("ask" to "Every change waits for approval", "auto" to "Only risky actions wait", "plan" to "Read only: nothing changes", "dangerous" to "Changes apply immediately").forEach { (value, detail) ->
                    DropdownMenuItem(
                        text = { Column { T(value.replaceFirstChar { it.uppercase() }, 13, if (value == "dangerous") HColors.accent else HColors.fg, bold = value == mode); T(detail, 10, HColors.muted) } },
                        onClick = { menu = false; onMode(value) },
                    )
                }
            }
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
