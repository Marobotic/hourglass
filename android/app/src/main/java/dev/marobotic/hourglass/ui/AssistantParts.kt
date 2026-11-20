package dev.marobotic.hourglass.ui

import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.animation.core.RepeatMode
import androidx.compose.ui.draw.alpha
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
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
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.marobotic.hourglass.core.ChatStream
import dev.marobotic.hourglass.data.Repo
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

private fun JSONObject.text(key: String): String = if (isNull(key)) "" else optString(key)

// Press and hold anything to get a small menu; taps still reach what is inside.
@Composable
internal fun LongPressMenu(items: List<Pair<String, () -> Unit>>, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    var open by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    Box(modifier.pointerInput(items.isEmpty()) { if (items.isNotEmpty()) detectTapGestures(onLongPress = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); open = true }) }) {
        content()
        DropdownMenu(open, { open = false }, containerColor = HColors.surface, shape = RectangleShape) {
            for ((label, action) in items) DropdownMenuItem(text = { T(label, 13) }, onClick = { open = false; action() })
        }
    }
}

// One thing the assistant did: a spinner, then a tick; tap to see what went in
// and what came out, how long it took and (for files) the lines it changed.
@Composable
internal fun ToolRow(tool: JSONObject) {
    val status = tool.text("status")
    val done = status == "completed" || status == "error"
    val input = tool.text("input")
    val output = tool.text("output")
    val diff = tool.optJSONObject("diff")
    val hasDetail = input.isNotBlank() || output.isNotBlank() || (diff != null && diff.optJSONArray("lines")?.length() ?: 0 > 0)
    var open by remember(tool.text("call_id")) { mutableStateOf(false) }
    val spin = rememberInfiniteTransition(label = "spin").animateFloat(0f, 360f, infiniteRepeatable(tween(1200, easing = LinearEasing)), label = "r")
    val pop = remember(done) { Animatable(if (done) 0.3f else 1f) }
    LaunchedEffect(done) { if (done) pop.animateTo(1f, spring(dampingRatio = 0.35f, stiffness = Spring.StiffnessMedium)) }
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.then(if (hasDetail) Modifier.clickable { open = !open } else Modifier).padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            val pulse = if (done) 1f else rememberInfiniteTransition(label = "dot").animateFloat(1f, 0.35f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "a").value
            T(when (status) { "completed" -> "✓"; "error" -> "✕"; else -> "●" }, 13, when (status) { "completed" -> HColors.teal; "error" -> HColors.accentInk; else -> HColors.accentInk },
                modifier = Modifier.width(14.dp).scale(pop.value).alpha(pulse))
            Spacer(Modifier.width(8.dp))
            T(tool.text("label").ifBlank { tool.text("tool") }, 13, if (status == "error") HColors.accentInk else HColors.fg, modifier = Modifier.weight(1f, fill = false), maxLines = 1)
            if (!tool.isNull("duration_ms") && tool.has("duration_ms")) { Spacer(Modifier.width(8.dp)); T(ChatStream.duration(tool.optLong("duration_ms")), 11, HColors.faint) }
            if (diff != null && diff.optInt("added") + diff.optInt("removed") > 0) {
                Spacer(Modifier.width(8.dp))
                T("+${diff.optInt("added")}", 11, HColors.teal, bold = true)
                Spacer(Modifier.width(4.dp))
                T("−${diff.optInt("removed")}", 11, HColors.accent, bold = true)
            }
            if (hasDetail) { Spacer(Modifier.width(8.dp)); T(if (open) "▴" else "▾", 11, HColors.faint) }
        }
        AnimatedVisibility(open, enter = fadeIn(tween(150)) + expandVertically(), exit = fadeOut(tween(100)) + shrinkVertically()) {
            Column(Modifier.padding(start = 22.dp, top = 4.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (input.isNotBlank()) ToolBlock("Input", ChatStream.pretty(input))
                if (output.isNotBlank()) ToolBlock("Output", ChatStream.pretty(output))
                val lines = ChatStream.objects(diff?.optJSONArray("lines"))
                if (lines.isNotEmpty()) {
                    T("CHANGES", 10, HColors.muted, bold = true, spacing = 1.0)
                    Column(Modifier.fillMaxWidth().border(1.dp, HColors.border).background(HColors.surface).horizontalScroll(rememberScrollState()).padding(8.dp)) {
                        for (l in lines.take(80)) {
                            val op = l.optString("op")
                            when (op) {
                                "skip" -> T("… ${l.optInt("count")} unchanged lines", 11, HColors.faint)
                                else -> androidx.compose.material3.Text(
                                    (if (op == "add") "+ " else if (op == "del") "− " else "  ") + l.text("text"),
                                    color = when (op) { "add" -> HColors.teal; "del" -> HColors.accent; else -> HColors.muted },
                                    fontFamily = Mono, fontSize = 12.sp, softWrap = false,
                                )
                            }
                        }
                        if (lines.size > 80) T("… ${lines.size - 80} more lines", 11, HColors.faint)
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolBlock(title: String, body: String) {
    T(title.uppercase(), 10, HColors.muted, bold = true, spacing = 1.0)
    androidx.compose.material3.Text(
        body, Modifier.fillMaxWidth().border(1.dp, HColors.border).background(HColors.surface).horizontalScroll(rememberScrollState()).padding(8.dp),
        color = HColors.fg, fontFamily = Mono, fontSize = 12.sp, lineHeight = 17.sp, softWrap = false,
    )
}

// A message that waits for the one before it: greyed, with a way to take it back.
@Composable
internal fun QueuedRow(text: String, files: Int, onSendNow: (() -> Unit)? = null, onCancel: () -> Unit) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        T(text.ifBlank { "(attachments)" } + if (files > 0) "  · $files file" + (if (files > 1) "s" else "") else "", 14, HColors.muted,
            modifier = Modifier.fillMaxWidth(0.8f).wrapContentWidth(Alignment.End).border(1.dp, HColors.border).background(HColors.surface).padding(horizontal = 14.dp, vertical = 10.dp))
        // Metro's tag: gold "Queued · after this reply", Send now (engines that take a steer), and a cancel.
        Row(Modifier.border(1.dp, HColors.border).padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            T("Queued · after this reply", 11, HColors.gold)
            if (onSendNow != null) {
                Spacer(Modifier.width(8.dp))
                T("Send now", 11, HColors.fg, modifier = Modifier.border(1.dp, HColors.accent.copy(alpha = 0.6f)).background(HColors.accent.copy(alpha = 0.14f)).clickable(onClick = onSendNow).padding(horizontal = 8.dp, vertical = 2.dp))
            }
            Box(Modifier.size(28.dp).clickable(onClick = onCancel), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Close, "Cancel", Modifier.size(12.dp), tint = HColors.muted) }
        }
    }
}

// Metro's spark: the glyph steps through its frames and shimmers while a turn runs.
@Composable
internal fun Spark() {
    val t = rememberInfiniteTransition(label = "spark")
    val frame by t.animateFloat(0f, 7f, infiniteRepeatable(tween(1200, easing = LinearEasing)), label = "f")
    val glow by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1000), RepeatMode.Reverse), label = "g")
    val frames = listOf("·", "✢", "✳", "✶", "✻", "✽", "✻")
    T(frames[frame.toInt().coerceIn(0, 6)], 13, androidx.compose.ui.graphics.lerp(HColors.accentInk, HColors.fg, glow * 0.45f), bold = true, modifier = Modifier.width(14.dp))
}

// "Limit reached, continues at 14:05": one quiet line, no alarm.
@Composable
internal fun QuotaLine(quota: JSONObject) {
    val at = if (quota.isNull("resets_at")) 0L else quota.optLong("resets_at")
    val words = if (at > 0) {
        val fmt = if (at - System.currentTimeMillis() > 20 * 3600_000L) DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT) else DateFormat.getTimeInstance(DateFormat.SHORT)
        "Limit reached, continues at ${fmt.format(Date(at))}"
    } else "Limit reached, try again later"
    T(words, 12, HColors.muted, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp))
}

// How full the model's window is; opens the usage sheet.
@Composable
internal fun ContextMeter(percent: Double, onClick: () -> Unit) {
    Row(Modifier.border(1.dp, HColors.border).background(HColors.surface2).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(34.dp).height(4.dp).background(HColors.border)) {
            Box(Modifier.width((34 * (percent / 100.0).coerceIn(0.0, 1.0)).dp).height(4.dp).background(if (percent >= 85) HColors.accent else HColors.muted))
        }
        Spacer(Modifier.width(8.dp))
        T("${"%.1f".format(java.util.Locale.US, percent).trimEnd('0').trimEnd('.')}%", 10, HColors.fg, maxLines = 1)
    }
}

private fun tokens(n: Long): String = when {
    n >= 1_000_000 -> "%.1fM".format(java.util.Locale.US, n / 1_000_000.0)
    n >= 1000 -> "%.1fk".format(java.util.Locale.US, n / 1000.0)
    else -> n.toString()
}

private fun money(o: JSONObject): String = if (o.isNull("cost") || !o.has("cost")) "—" else "$" + "%.4f".format(java.util.Locale.US, o.optDouble("cost")) + if (o.optInt("unpriced_runs") > 0) "+" else ""

// What it costs and what is left: the context window, today, the last two weeks.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun UsageSheet(repo: Repo, onDismiss: () -> Unit) {
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var problem by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        repo.assistant("GET", "/usage?days=14") { d, err -> if (d == null) problem = err ?: "Could not load usage." else data = d }
    }
    ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = HColors.surface, dragHandle = null) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 20.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { T("Usage", 20, bold = true); data?.let { T(it.text("engine_name") + " · " + it.text("model"), 12, HColors.muted, maxLines = 1) } }
                IconButton(onDismiss) { Icon(Icons.Outlined.Close, "Close", tint = HColors.muted) }
            }
            if (data == null && problem.isBlank()) T("Loading usage…", 13, HColors.muted)
            if (problem.isNotBlank()) T(problem, 13, HColors.accent)
            val d = data
            if (d != null) {
                d.optJSONObject("quota")?.takeIf { it.optString("state") != "ok" }?.let { QuotaLine(it) }
                d.optJSONObject("context")?.let { c ->
                    UsageSection("Context window")
                    val pct = if (c.isNull("percent")) 0.0 else c.optDouble("percent")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.weight(1f).height(6.dp).background(HColors.border)) { Box(Modifier.fillMaxWidth((pct / 100.0).coerceIn(0.0, 1.0).toFloat()).height(6.dp).background(if (pct >= 85) HColors.accent else HColors.muted)) }
                        Spacer(Modifier.width(10.dp))
                        T("${"%.1f".format(java.util.Locale.US, pct)}% of ${tokens(c.optLong("window"))}", 12)
                    }
                    T("${tokens(c.optLong("input_tokens"))} in · ${tokens(c.optLong("output_tokens"))} out · ${tokens(c.optLong("cache_read_input_tokens"))} cached", 11, HColors.muted)
                }
                d.optJSONObject("today")?.let { UsageSection("Today"); UsageNumbers(it) }
                d.optJSONObject("totals")?.let { UsageSection("Last 14 days"); UsageNumbers(it) }
                val days = ChatStream.objects(d.optJSONArray("days"))
                if (days.isNotEmpty()) {
                    val top = days.maxOf { it.optLong("tokens") }.coerceAtLeast(1)
                    Row(Modifier.fillMaxWidth().height(48.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom) {
                        for (day in days) Box(Modifier.weight(1f).height((4 + 44.0 * day.optLong("tokens") / top).dp).background(if (day.optLong("tokens") > 0) HColors.accent else HColors.border))
                    }
                }
                val engines = ChatStream.objects(d.optJSONArray("engines"))
                if (engines.isNotEmpty()) {
                    UsageSection("By AI")
                    for (e in engines) Row(Modifier.fillMaxWidth()) {
                        T(e.text("engine"), 12, modifier = Modifier.weight(1f))
                        T("${e.optInt("runs")} runs · ${tokens(e.optLong("tokens"))} · ${money(e)}", 12, HColors.muted)
                    }
                }
                d.optJSONObject("limits")?.let { l ->
                    UsageSection("Limits")
                    T("${l.optInt("messages_per_hour")} messages an hour · ${l.optInt("max_queued")} waiting at most" + (l.text("plan").takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""), 12, HColors.muted)
                }
                d.optJSONObject("deepseek")?.text("line")?.takeIf { it.isNotBlank() }?.let { T(it, 12, HColors.muted) }
            }
        }
    }
}

@Composable
private fun UsageSection(title: String) = T(title.uppercase(), 10, HColors.muted, bold = true, spacing = 1.2)

@Composable
private fun UsageNumbers(o: JSONObject) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        Column { T("${o.optInt("runs")}", 16, bold = true); T("runs", 10, HColors.muted) }
        Column { T(tokens(o.optLong("tokens")), 16, bold = true); T("tokens", 10, HColors.muted) }
        Column { T(money(o), 16, bold = true); T("cost", 10, HColors.muted) }
    }
}
