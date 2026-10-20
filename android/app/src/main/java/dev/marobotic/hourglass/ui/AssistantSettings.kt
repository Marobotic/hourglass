package dev.marobotic.hourglass.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.marobotic.hourglass.data.Repo
import org.json.JSONArray
import org.json.JSONObject

private fun JSONArray?.objects(): List<JSONObject> = this?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } } ?: emptyList()

// Which AI answers in the assistant (as on the desktop, AssistantSettings.qml):
// opencode's free models, Claude with the user's plan or API key, or another
// OpenAI-compatible API. A key goes to the server once, stored encrypted there.
@Composable
fun AssistantSettingsDialog(repo: Repo, onDismiss: () -> Unit, onSaved: () -> Unit) {
    val ctx = LocalContext.current
    var s by remember { mutableStateOf<JSONObject?>(null) }
    var engine by remember { mutableStateOf("free") }
    var model by remember { mutableStateOf("") }
    var baseUrl by remember { mutableStateOf("") }
    var apiModels by remember { mutableStateOf<List<String>>(emptyList()) }
    var key by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var signin by remember { mutableStateOf("") } // "", starting, waiting, finishing
    var pasteToken by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    fun hasKey(): Boolean = s?.optJSONObject("has_key")?.optBoolean(if (engine == "openai") "openai:$baseUrl" else engine) == true
    fun loadModels() {
        apiModels = emptyList()
        repo.assistant("GET", "/models?base_url=" + Uri.encode(baseUrl)) { d, _ ->
            apiModels = d?.optJSONArray("models").objects().map { it.optString("id") }
            d?.optString("error")?.takeIf { it.isNotBlank() && hasKey() }?.let { note = it }
        }
    }
    LaunchedEffect(Unit) {
        repo.assistant("GET", "/settings") { d, err ->
            if (d == null) { error = err ?: "Could not load the settings."; return@assistant }
            s = d
            engine = d.optString("engine", "free")
            model = d.optString("model")
            baseUrl = d.optString("base_url").ifBlank { d.optJSONArray("presets").objects().firstOrNull()?.optString("base_url").orEmpty() }
            if (engine == "openai") loadModels()
        }
    }
    fun modelOptions(): List<Pair<String, String>> {
        val d = s ?: return emptyList()
        return when (engine) {
            "free" -> d.optJSONArray("free_models").objects().map { it.optString("name") to it.optString("id") }
            "anthropic", "claude" -> d.optJSONArray("claude_models").objects().map { "${it.optString("name")}  · ${it.optString("note")}" to it.optString("id") }
            else -> apiModels.map { it to it }
        }
    }

    AlertDialog(
        onDismissRequest = {
            if (signin.isNotEmpty()) repo.assistant("POST", "/claude/login/cancel") { _, _ -> }
            onDismiss()
        },
        containerColor = HColors.surface, shape = RectangleShape,
        title = { Column { T("Assistant AI", 17, bold = true); T("Pick who answers. Keys are stored encrypted on your account.", 12, HColors.muted) } },
        text = {
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for (e in s?.optJSONArray("engines").objects()) {
                    val on = engine == e.optString("id")
                    Row(
                        Modifier.fillMaxWidth().border(1.dp, if (on) HColors.accent else HColors.border).background(if (on) HColors.surface2 else Color.Transparent)
                            .clickable {
                                if (!on) { engine = e.optString("id"); model = ""; error = ""; note = ""; key = ""; if (engine == "openai") loadModels() }
                            }.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(14.dp).border(2.dp, if (on) HColors.accent else HColors.muted), contentAlignment = Alignment.Center) {
                            if (on) Box(Modifier.size(6.dp).background(HColors.accent))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column { T(e.optString("name"), 14, bold = on); T(e.optString("note"), 12, HColors.muted) }
                    }
                }
                if (engine == "openai") {
                    T("API", 11, HColors.muted, spacing = 1.0)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (p in s?.optJSONArray("presets").objects()) {
                            val on = baseUrl == p.optString("base_url")
                            Box(Modifier.border(1.dp, if (on) HColors.accent else HColors.border).clickable { baseUrl = p.optString("base_url"); model = ""; loadModels() }.padding(horizontal = 10.dp, vertical = 6.dp)) {
                                T(p.optString("name"), 12, if (on) HColors.fg else HColors.muted)
                            }
                        }
                    }
                    Field(baseUrl, { baseUrl = it.trim(); model = "" }, "Address", placeholder = "https://…/v1")
                }
                if (engine == "claude") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        HButton(
                            when { signin == "starting" -> "Opening…"; hasKey() -> "Sign in again"; else -> "Sign in with Claude" },
                            primary = !hasKey(), enabled = signin.isEmpty() && s?.optBoolean("claude_ready") == true,
                        ) {
                            error = ""; note = ""; signin = "starting"
                            repo.assistant("POST", "/claude/login") { d, err ->
                                if (d == null) { signin = ""; error = err ?: "Could not start the sign-in."; return@assistant }
                                signin = "waiting"
                                runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(d.optString("url")))) }
                            }
                        }
                        if (hasKey() && signin.isEmpty()) { Spacer(Modifier.width(10.dp)); T("✓ Connected", 12, HColors.teal) }
                    }
                    if (signin == "waiting" || signin == "finishing") {
                        T("Sign in on the page that opened and press Authorize. Claude then shows a code: copy it and paste it here.", 12, HColors.muted)
                        Field(code, { code = it }, "Code from claude.com")
                        HButton(if (signin == "finishing") "Finishing…" else "Finish", primary = true, enabled = signin == "waiting" && code.isNotBlank()) {
                            error = ""; signin = "finishing"
                            repo.assistant("POST", "/claude/login/code", JSONObject().put("code", code.trim())) { d, err ->
                                if (d == null) { signin = ""; error = err ?: "Could not finish the sign-in."; return@assistant }
                                signin = ""; code = ""
                                s?.put("has_key", d.optJSONObject("has_key"))
                                note = "Signed in with your Claude account ✓"
                            }
                        }
                    }
                    if (signin.isEmpty()) T(if (pasteToken) "▴ Paste a token instead" else "▾ Or paste a token from claude setup-token", 11, HColors.faint, modifier = Modifier.clickable { pasteToken = !pasteToken })
                    if (s?.optBoolean("claude_ready") == false) T("Claude Code isn't installed on the server yet: this choice will work once it is.", 12, HColors.gold)
                }
                if (engine != "free" && (engine != "claude" || pasteToken)) {
                    T(if (engine == "claude") "CLAUDE TOKEN" else "API KEY", 11, HColors.muted, spacing = 1.0)
                    Field(key, { key = it }, if (hasKey()) "Saved ✓ (paste a new one to replace it)" else if (engine == "anthropic") "sk-ant-api…" else if (engine == "claude") "sk-ant-oat…" else "Your API key", password = true)
                }
                T("MODEL", 11, HColors.muted, spacing = 1.0)
                val opts = modelOptions()
                val current = model.ifBlank { opts.firstOrNull()?.second.orEmpty() }
                var open by remember { mutableStateOf(false) }
                Box {
                    Row(Modifier.fillMaxWidth().border(1.dp, HColors.border).clickable(enabled = opts.isNotEmpty()) { open = true }.padding(12.dp)) {
                        T(opts.firstOrNull { it.second == current }?.first ?: if (engine == "openai") (if (hasKey()) "Loading this API's models…" else "Save your key first, then pick a model.") else "—", 13, maxLines = 1)
                    }
                    DropdownMenu(open, { open = false }, containerColor = HColors.surface) {
                        for ((label, id) in opts) DropdownMenuItem(text = { T(label, 13, if (id == current) HColors.fg else HColors.muted) }, onClick = { model = id; open = false })
                    }
                }
                if (note.isNotBlank()) T(note, 12, HColors.muted)
                if (error.isNotBlank()) T(error, 13, HColors.accent)
            }
        },
        confirmButton = {
            HButton(if (saving) "Checking…" else "Save", primary = true, enabled = !saving && s != null && (engine == "free" || hasKey() || key.isNotBlank())) {
                error = ""; saving = true
                val body = JSONObject().put("engine", engine).put("model", model.ifBlank { modelOptions().firstOrNull()?.second.orEmpty() })
                if (engine == "openai") body.put("base_url", baseUrl)
                if (key.isNotBlank()) body.put("key", key.trim())
                repo.assistant("POST", "/settings", body) { d, err ->
                    saving = false
                    if (d == null) { error = err ?: "Could not save."; return@assistant }
                    onSaved()
                    onDismiss()
                }
            }
        },
        dismissButton = { HButton("Cancel", onClick = onDismiss) },
    )
}
