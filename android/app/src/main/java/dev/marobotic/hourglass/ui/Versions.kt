package dev.marobotic.hourglass.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.data.Repo
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject

// A Drive file's versions: every time its contents were replaced (an edit
// saved on a device, a restore) the copy before was kept, with who, which
// device and when. Each can be compared with now (line by line for text, side
// by side for pictures), saved as a copy, or put back (what's there now is
// kept as a version too).
@Composable
fun VersionsDialog(repo: Repo, f: JSONObject, onDismiss: () -> Unit) {
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<String?>(null) } // the version whose changes are showing
    var reload by remember { mutableStateOf(0) }
    var saving by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(reload) { repo.versions(f.id) { d, err -> data = d; problem = err } }
    val saver = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val vid = saving
        saving = null
        if (uri != null && vid != null) repo.saveVersionTo(f.id, vid, uri) { err -> problem = err ?: "Saved a copy." }
    }
    fun whoOf(v: JSONObject) = listOfNotNull(v.optString("device").ifBlank { null }, v.optString("by").ifBlank { null }).joinToString(" · ").ifBlank { "unknown device" }
    fun whenOf(ms: Long) = if (ms <= 0) "" else "${Dates.short(java.time.Instant.ofEpochMilli(ms).atZone(repo.zone).toLocalDate())}  ${Dates.clock(ms, repo.zone)}"
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = HColors.surface, shape = RectangleShape,
        title = {
            Column {
                T("Versions of ${f.optString("name")}", 16, bold = true, maxLines = 2)
                T("Each time it's saved, the copy before is kept (the last 20).", 12, HColors.muted)
            }
        },
        text = {
            val d = data
            LazyColumn(Modifier.heightIn(max = 520.dp)) {
                problem?.let { p -> item { T(p, 13, if (p == "Saved a copy.") HColors.teal else HColors.accent, modifier = Modifier.padding(bottom = 8.dp)) } }
                if (d == null) { if (problem == null) item { T("Reading the versions…", 13, HColors.muted) }; return@LazyColumn }
                val cur = d.getJSONObject("current")
                item {
                    Row(Modifier.padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        T("NOW", 11, HColors.teal, bold = true, modifier = Modifier.background(HColors.teal.copy(alpha = 0.18f)).padding(horizontal = 6.dp, vertical = 2.dp))
                        Spacer(Modifier.width(10.dp))
                        Column {
                            T("${whenOf(cur.optLong("at"))}   ${fmtBytes(cur.optLong("size"))}", 13)
                            T(whoOf(cur) + if (!cur.isNull("restored_from") && cur.optString("restored_from").isNotBlank()) "  ·  put back from an older version" else "", 12, HColors.muted, maxLines = 1)
                        }
                    }
                }
                val list = d.optJSONArray("versions") ?: JSONArray()
                if (list.length() == 0) item { T("No older versions yet. When this file is edited and saved again, the copy before is kept here.", 13, HColors.faint) }
                items((0 until list.length()).map { list.getJSONObject(it) }, key = { it.id }) { v ->
                    Column(Modifier.fillMaxWidth().border(1.dp, HColors.border).padding(10.dp)) {
                        T("${whenOf(v.optLong("at"))}   ${fmtBytes(v.optLong("size"))}", 13)
                        T(whoOf(v) + if (v.optString("restored_from").isNotBlank()) "  ·  put back from an older version" else "", 12, HColors.muted, maxLines = 1)
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            HButton(if (open == v.id) "Hide changes" else "What changed") { open = if (open == v.id) null else v.id }
                            HButton("Save…") { saving = v.id; saver.launch(f.optString("name").ifBlank { "file" }) }
                            HButton("Restore", primary = true) {
                                repo.restoreVersion(f.id, v.id) { err -> problem = err; if (err == null) { open = null; reload++ } }
                            }
                        }
                        if (open == v.id) {
                            Spacer(Modifier.height(8.dp))
                            if (d.optBoolean("picture")) PicturesThenNow(repo, f, v.id) else Changes(repo, f, v.id)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
        },
        confirmButton = { HButton("Close", onClick = onDismiss) },
    )
}

@Composable
private fun Changes(repo: Repo, f: JSONObject, vid: String) {
    val diff by produceState<Pair<JSONObject?, String?>?>(null, vid) {
        value = suspendCancellableCoroutine { k -> repo.versionDiff(f.id, vid) { d, err -> if (k.isActive) k.resume(d to err) } }
    }
    val r = diff
    Column(Modifier.fillMaxWidth().background(HColors.bg).border(1.dp, HColors.border).padding(6.dp)) {
        val d = r?.first
        when {
            r == null -> T("Comparing…", 12, HColors.muted)
            d == null -> T(r.second ?: "Could not compare them.", 12, HColors.accent)
            d.optString("kind") != "text" -> T("This kind of file can't be compared line by line. Then: ${fmtBytes(d.optLong("before"))}, now: ${fmtBytes(d.optLong("after"))}.", 12, HColors.muted)
            d.optBoolean("tooBig") -> T("Too many changes to show here (${d.optInt("added")} lines in, ${d.optInt("removed")} out).", 12, HColors.muted)
            else -> {
                T("+${d.optInt("added")} lines   −${d.optInt("removed")} lines", 11, HColors.muted, modifier = Modifier.padding(bottom = 4.dp))
                val lines = d.optJSONArray("lines") ?: JSONArray()
                for (i in 0 until minOf(lines.length(), 400)) {
                    val l = lines.getJSONObject(i)
                    val op = l.optString("op")
                    val text = if (op == "skip") "⋯ ${l.optInt("count")} lines the same" else (when (op) { "add" -> "+ "; "del" -> "− "; else -> "  " }) + l.optString("text")
                    androidx.compose.material3.Text(
                        text, color = if (op == "skip") HColors.faint else HColors.fg, fontFamily = FontFamily.Monospace, fontSize = 11.sp,
                        modifier = Modifier.fillMaxWidth().background(when (op) { "add" -> HColors.teal.copy(alpha = 0.2f); "del" -> HColors.accent.copy(alpha = 0.2f); else -> androidx.compose.ui.graphics.Color.Transparent }).padding(horizontal = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun PicturesThenNow(repo: Repo, f: JSONObject, vid: String) {
    val then by produceState<ImageBitmap?>(null, vid) {
        value = suspendCancellableCoroutine { k -> repo.versionFile(f.id, vid) { file, _ -> if (k.isActive) k.resume(file?.let { runCatching { decodeScaled(it, 800) }.getOrNull() }) } }
    }
    val now by produceState<ImageBitmap?>(null, f.id) {
        value = suspendCancellableCoroutine { k -> repo.download(f.id) { file, _ -> if (k.isActive) k.resume(file?.let { runCatching { decodeScaled(it, 800) }.getOrNull() }) } }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((label, img) in listOf("THEN" to then, "NOW" to now)) Column(Modifier.weight(1f)) {
            T(label, 11, HColors.muted, bold = true)
            Box(Modifier.fillMaxWidth().height(160.dp).background(HColors.bg), contentAlignment = Alignment.Center) {
                if (img != null) Image(img, label, Modifier.fillMaxWidth().height(160.dp), contentScale = ContentScale.Fit) else T("…", 13, HColors.faint)
            }
        }
    }
}
