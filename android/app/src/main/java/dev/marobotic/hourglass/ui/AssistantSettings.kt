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
import kotlinx.coroutines.delay
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
    var deepSeekPriceLine by remember { mutableStateOf("") }
    var apiModels by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var key by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var signin by remember { mutableStateOf("") } // "", starting, waiting, finishing
    var pasteToken by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    fun hasKey(): Boolean = s?.optJSONObject("has_key")?.optBoolean(if (engine == "openai") "openai:$baseUrl" else engine) == true
    fun isDeepSeek(): Boolean = engine == "openai" && baseUrl.contains("api.deepseek.com")
    fun loadModels() {
        apiModels = emptyList()
        repo.assistant("GET", "/models?base_url=" + Uri.encode(baseUrl)) { d, _ ->
            apiModels = d?.optJSONArray("models").objects()
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
    LaunchedEffect(engine, baseUrl) {
        deepSeekPriceLine = ""
        while (isDeepSeek()) {
            repo.assistant("GET", "/deepseek-pricing") { d, _ -> deepSeekPriceLine = d?.optString("line").orEmpty() }
            delay(60_000)
        }
    }
    fun modelOptions(): List<Pair<String, String>> {
        val d = s ?: return emptyList()
        return when (engine) {
            "free" -> d.optJSONArray("free_models").objects().map { it.optString("name") to it.optString("id") }
            "anthropic", "claude" -> d.optJSONArray("claude_models").objects().map { modelLabel(it) to it.optString("id") }
            else -> apiModels.map { modelLabel(it) to it.optString("id") }
        }
    }
    fun modelLabel(m: JSONObject): String = buildString {
        append(m.optString("name").ifBlank { m.optString("id") })
        m.optString("note").takeIf { it.isNotBlank() }?.let { append("  · ").append(it) }
        if (m.has("supports_tools") && !m.optBoolean("supports_tools")) append("  · tools unsupported")
        m.optLong("context_window").takeIf { it > 0 }?.let { n -> append("  · ").append(if (n >= 1_000_000) "${n / 1_000_000}M" else "${n / 1000}k") }
        m.optJSONObject("pricing")?.let { p ->
            if (!p.isNull("input") && !p.isNull("output")) append("  · $").append("%.3g".format(p.optDouble("input") * 1_000_000)).append("/$").append("%.3g".format(p.optDouble("output") * 1_000_000)).append(" per 1M")
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
                if ((engine == "claude" || engine == "anthropic") && s?.optString("claude_model_source") == "fallback") T("Using the default Claude model list.", 11, HColors.muted)
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
                            when { signin == "starting" -> "Opening claude.com…"; hasKey() -> "Sign in again"; else -> "Sign in with Claude" },
                            primary = !hasKey(), enabled = signin.isEmpty() && s?.optBoolean("claude_ready") == true,
                        ) {
                            error = ""; note = ""; signin = "starting"
                            repo.assistant("POST", "/claude/login") { d, err ->
                                if (d == null) { signin = ""; error = err ?: "Could not start the sign-in."; return@assistant }
                                signin = "waiting"
                                runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(d.optString("url")))) }
                                    .onFailure { signin = ""; error = "Could not open claude.com. Open the link again or paste a token instead." }
                            }
                        }
                        if (hasKey() && signin.isEmpty()) { Spacer(Modifier.width(10.dp)); T("✓ Connected as Claude Pro/Max", 12, HColors.teal) }
                    }
                    if (signin == "waiting" || signin == "finishing") {
                        T(if (signin == "finishing") "Connecting… Checking the subscription token with Claude." else "Paste the code from claude.com, including any #state part. Spaces and line breaks are okay.", 12, HColors.muted)
                        Field(code, { code = it }, "Code from claude.com")
                        HButton(if (signin == "finishing") "Connecting…" else "Finish", primary = true, enabled = signin == "waiting" && code.isNotBlank()) {
                            error = ""; signin = "finishing"
                            repo.assistant("POST", "/claude/login/code", JSONObject().put("code", code.trim())) { d, err ->
                                if (d == null) { signin = ""; error = err ?: "Could not finish the sign-in."; return@assistant }
                                signin = ""; code = ""
                                s?.put("has_key", d.optJSONObject("has_key"))
                                note = "Connected as Claude Pro/Max ✓"
                            }
                        }
                    }
                    if (signin.isEmpty()) T(if (pasteToken) "▴ Paste a token instead" else "▾ Or paste a token from claude setup-token", 11, HColors.faint, modifier = Modifier.clickable { pasteToken = !pasteToken })
                    if (s?.optBoolean("claude_ready") == false) T("Claude Code isn't installed on the server yet: this choice will work once it is.", 12, HColors.gold)
                }
                if (engine != "free" && (engine != "claude" || pasteToken)) {
                    T(if (engine == "claude") "CLAUDE TOKEN" else "API KEY", 11, HColors.muted, spacing = 1.0)
                    if (engine == "claude") T("On your own PC, run claude setup-token in a terminal with Claude Code installed. Sign in, then paste the sk-ant-oat token it prints.", 12, HColors.faint)
                    Field(key, { key = it }, if (hasKey()) "Saved ✓ (paste a new one to replace it)" else if (engine == "anthropic") "sk-ant-api…" else if (engine == "claude") "sk-ant-oat…" else if (isDeepSeek()) "DeepSeek API key" else "Your API key", password = true)
                    if (isDeepSeek()) T("Get a DeepSeek API key", 11, HColors.muted, modifier = Modifier.clickable { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://platform.deepseek.com/api_keys"))) })
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
                if (isDeepSeek() && deepSeekPriceLine.isNotBlank()) T(deepSeekPriceLine, 11, HColors.faint)
                if (engine == "free" && s?.optJSONObject("free_model_discovery")?.optString("status") == "discovery failed")
                    T("Model discovery failed; showing the configured fallback models.", 12, HColors.faint)
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
