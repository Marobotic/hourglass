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

private val SUGGESTIONS = listOf("What's on today?", "Tidy up my latest note", "Wake me at 7:30 on weekdays", "Start a 25 minute timer")

// Talk to Hourglass: the assistant runs on the server (opencode) and works on
// this account's notes, schedule, alarms and timers. Each tool it uses shows as
// a line ("Set an alarm"); when it finishes, the phone syncs the changes in.
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
        val t = text.trim()
        if (t.isEmpty() || busy || !enabled) return
        pending = t; sending = true; wasBusy = true; input = ""
        repo.assistant("POST", "/message", JSONObject().put("text", t)) { o, err ->
            sending = false
            if (o == null) { pending = null; input = t; problem = err } else load()
        }
    }

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

        // The message box
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Bottom) {
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
            else HButton("", primary = true, icon = Icons.AutoMirrored.Outlined.Send, enabled = enabled && input.isNotBlank()) { send(input) }
        }
    }
}

@Composable
private fun Message(m: JSONObject, opener: FileOpener) {
    val mine = m.optString("role") == "user"
    val text = m.optString("text")
    if (mine) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
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
