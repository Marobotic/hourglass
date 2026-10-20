package dev.marobotic.hourglass.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.StickyNote2
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

// What the assistant did, drawn (as on the desktop, ResultCard.qml): an alarm is
// a clock face showing its time, a timer a ring counting down, an event a
// calendar page (a cake for a birthday) with the days to go, a day its timeline.
// The server writes every card's text (server/cards.js); this only draws.
@Composable
fun ResultCardView(info: JSONObject, now: Long, modifier: Modifier = Modifier) {
    val kind = info.optString("kind")
    val st = info.optString("state")
    val gone = st == "removed" || st == "stopped" || st == "off"
    val accent = when (kind) {
        "alarm" -> HColors.accent
        "timer" -> HColors.teal
        "event" -> if (info.optBoolean("birthday")) HColors.gold else HColors.orange
        else -> HColors.teal
    }
    val secsLeft = if (kind == "timer" && info.optLong("ends_at") > 0) max(0L, ceil((info.optLong("ends_at") - now) / 1000.0).toLong()) else 0L

    // It pops in once: a little rise and settle.
    val appear = remember { Animatable(0f) }
    val pop = remember { Animatable(0.92f) }
    LaunchedEffect(Unit) { appear.animateTo(1f, tween(260)) }
    LaunchedEffect(Unit) { pop.animateTo(1f, spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessMediumLow)) }

    Box(
        modifier.scale(pop.value).alpha(appear.value * if (gone) 0.75f else 1f)
            .border(1.dp, if (gone) HColors.border else accent.copy(alpha = 0.55f)).background(HColors.surface).padding(12.dp),
    ) {
        if (kind == "day") DayCard(info) else Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(64.dp), contentAlignment = Alignment.Center) {
                when (kind) {
                    "alarm" -> AlarmFace(info.optInt("minutes"), gone)
                    "timer" -> TimerRing(st == "running", secsLeft, info.optLong("duration_s", 1))
                    "event" -> CalendarPage(info, accent)
                    else -> Box(Modifier.fillMaxSize().border(1.dp, HColors.border).background(HColors.bg), contentAlignment = Alignment.Center) {
                        Icon(if (kind == "note") Icons.Outlined.StickyNote2 else Icons.Outlined.Check, null, tint = HColors.teal, modifier = Modifier.size(26.dp))
                    }
                }
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val title = when (kind) { "alarm" -> info.optString("time"); "timer" -> info.optString("label").ifBlank { "Timer" }; else -> info.optString("label") }
                    androidx.compose.material3.Text(
                        title, Modifier.weight(1f, fill = false), color = HColors.fg, fontFamily = Mono, maxLines = 1,
                        fontSize = androidx.compose.ui.unit.TextUnit(if (kind == "alarm") 22f else 15f, androidx.compose.ui.unit.TextUnitType.Sp),
                        fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                        textDecoration = if (st == "removed") TextDecoration.LineThrough else null,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    )
                    badge(kind, st, secsLeft)?.let { (text, color) -> Spacer(Modifier.width(8.dp)); Badge(text, color) }
                }
                val sub = when (kind) {
                    "alarm" -> info.optString("label").ifBlank { "Alarm" }
                    "timer" -> if (st == "running") (if (secsLeft > 0) "rings in ${countdown(secsLeft)}" else "rang") else "stopped"
                    "event" -> listOf(info.optString("when"), info.optString("time")).filter { it.isNotBlank() }.joinToString(" · ")
                    "note" -> info.optString("course").ifBlank { if (st == "added") "New note" else "Note" }
                    else -> info.optString("value")
                }
                T(sub, 13, HColors.muted, maxLines = 1)
                val days = if (info.isNull("days_until")) null else info.optInt("days_until")
                val third = when (kind) {
                    "alarm" -> info.optString("when")
                    "event" -> when {
                        days != null && days > 1 -> "in $days days" + (info.optString("repeats").takeIf { it.isNotBlank() }?.let { " · $it" } ?: "")
                        days == 1 -> "tomorrow"
                        days == 0 -> "today!"
                        else -> info.optString("repeats")
                    }
                    else -> ""
                }
                if (third.isNotBlank()) T(third, 12, if (kind == "event" && days != null && days <= 7) accent else HColors.faint, maxLines = 1)
            }
        }
    }
}

private fun badge(kind: String, st: String, secsLeft: Long): Pair<String, Color>? = when {
    st == "removed" -> "REMOVED" to HColors.muted
    st == "stopped" -> "STOPPED" to HColors.muted
    st == "off" -> "OFF" to HColors.muted
    st == "on" -> "ON" to HColors.teal
    st == "added" -> "ADDED" to HColors.teal
    st == "changed" -> "CHANGED" to HColors.teal
    kind == "alarm" && st == "set" -> "SET" to HColors.teal
    kind == "timer" && st == "running" -> (if (secsLeft > 0) "RUNNING" else "DONE") to HColors.teal
    else -> null
}

// The badge springs in a beat after the card.
@Composable
private fun Badge(text: String, color: Color) {
    val s = remember { Animatable(0f) }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(260); s.animateTo(1f, spring(dampingRatio = 0.4f, stiffness = Spring.StiffnessMedium)) }
    Row(Modifier.scale(s.value).background(color.copy(alpha = 0.2f)).padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        if (text == "SET" || text == "ADDED") { Icon(Icons.Outlined.Check, null, tint = color, modifier = Modifier.size(10.dp)); Spacer(Modifier.width(3.dp)) }
        T(text, 10, color, bold = true, spacing = 1.0)
    }
}

private fun countdown(s: Long): String {
    val h = s / 3600; val m = (s % 3600) / 60; val x = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, x) else "%d:%02d".format(m, x)
}

// A clock face; the hands sweep round to the alarm's time.
@Composable
private fun AlarmFace(minutes: Int, gone: Boolean) {
    val shown = remember { Animatable((minutes - 120).toFloat()) }
    LaunchedEffect(minutes) { shown.animateTo(minutes.toFloat(), tween(750, easing = FastOutSlowInEasing)) }
    Canvas(Modifier.fillMaxSize()) {
        val r = size.minDimension / 2 - 3.dp.toPx()
        val c = center
        drawCircle(HColors.bg, r, c)
        drawCircle(if (gone) HColors.muted else HColors.accent, r, c, style = Stroke(2.dp.toPx()))
        for (i in 0 until 12) {
            val a = i * PI / 6
            val inner = if (i % 3 == 0) r - 8.dp.toPx() else r - 5.dp.toPx()
            drawLine(HColors.muted, Offset(c.x + sin(a).toFloat() * inner, c.y - cos(a).toFloat() * inner),
                Offset(c.x + sin(a).toFloat() * (r - 2.dp.toPx()), c.y - cos(a).toFloat() * (r - 2.dp.toPx())), if (i % 3 == 0) 2.dp.toPx() else 1.dp.toPx())
        }
        val mins = shown.value
        val ha = ((mins / 60f) % 12f) * PI / 6
        val ma = (mins % 60f) * PI / 30
        drawLine(HColors.fg, c, Offset(c.x + sin(ha).toFloat() * r * 0.5f, c.y - cos(ha).toFloat() * r * 0.5f), 3.dp.toPx(), StrokeCap.Round)
        drawLine(HColors.fg, c, Offset(c.x + sin(ma).toFloat() * r * 0.78f, c.y - cos(ma).toFloat() * r * 0.78f), 2.dp.toPx(), StrokeCap.Round)
        drawCircle(if (gone) HColors.muted else HColors.accent, 3.dp.toPx(), c)
    }
}

// A ring that empties as the timer counts down.
@Composable
private fun TimerRing(running: Boolean, secsLeft: Long, total: Long) {
    Box(contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val w = 6.dp.toPx()
            val inset = w / 2 + 2.dp.toPx()
            val box = Size(size.width - inset * 2, size.height - inset * 2)
            drawArc(HColors.surface2, 0f, 360f, false, Offset(inset, inset), box, style = Stroke(w))
            val frac = if (running) min(1f, secsLeft.toFloat() / max(1L, total)) else 0f
            if (frac > 0) drawArc(HColors.teal, -90f, frac * 360f, false, Offset(inset, inset), box, style = Stroke(w, cap = StrokeCap.Round))
        }
        T(if (running) countdown(secsLeft) else "–", if (secsLeft >= 3600) 10 else 12, bold = true)
    }
}

// A calendar page; a birthday gets a cake on it.
@Composable
private fun CalendarPage(info: JSONObject, accent: Color) {
    val parts = info.optString("when").split(" ")   // "Fri 5 Mar 2027", "today", "tomorrow"
    Column(Modifier.fillMaxSize().border(2.dp, accent).background(HColors.bg)) {
        Box(Modifier.fillMaxWidth().height(18.dp).background(accent), contentAlignment = Alignment.Center) {
            T((if (parts.size >= 3) parts[2] else info.optString("when")).uppercase(), 10, Color(0xFF121212), bold = true, maxLines = 1)
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (info.optBoolean("birthday")) Canvas(Modifier.fillMaxSize().padding(4.dp)) {
                val w = size.width; val h = size.height
                drawRect(HColors.gold, Offset(w * 0.18f, h * 0.55f), Size(w * 0.64f, h * 0.4f))
                drawRect(HColors.accent, Offset(w * 0.18f, h * 0.55f), Size(w * 0.64f, h * 0.1f))
                drawRect(HColors.fg, Offset(w * 0.47f, h * 0.25f), Size(w * 0.06f, h * 0.3f))
                drawOval(HColors.orange, Offset(w * 0.44f, h * 0.06f), Size(w * 0.12f, h * 0.2f))
            } else T(if (parts.size >= 2) parts[1] else if (info.optInt("days_until", -1) == 0) "★" else "", 24, bold = true)
        }
    }
}

// A day: its timeline, then the list.
@Composable
private fun DayCard(info: JSONObject) {
    val a = info.optJSONArray("items")
    val items = (0 until (a?.length() ?: 0)).map { a!!.getJSONObject(it) }
    val from = items.minOfOrNull { it.optInt("from") } ?: (8 * 60)
    val to = items.maxOfOrNull { it.optInt("to") } ?: (18 * 60)
    val span = max(1, to - from).toFloat()
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        T(info.optString("label").uppercase(), 11, HColors.muted, bold = true, spacing = 1.5)
        if (items.isEmpty()) T("Nothing on.", 14)
        else BoxWithConstraints(Modifier.fillMaxWidth().height(14.dp).background(HColors.surface2)) {
            for (it in items) {
                val x = maxWidth * ((it.optInt("from") - from) / span)
                val w = maxOf(4.dp, maxWidth * ((it.optInt("to") - it.optInt("from")) / span) - 2.dp)
                Box(Modifier.offset(x = x).width(w).fillMaxSize().background(hex(it.optString("color").takeIf { c -> c.isNotBlank() && c != "null" })))
            }
        }
        for (it in items) Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(hex(it.optString("color").takeIf { c -> c.isNotBlank() && c != "null" })))
            Spacer(Modifier.width(8.dp))
            T("${it.optString("start")}–${it.optString("end")}", 12, HColors.muted)
            Spacer(Modifier.width(8.dp))
            T(it.optString("title") + it.optString("location").takeIf { l -> l.isNotBlank() }?.let { l -> "  $l" }.orEmpty(), 13, maxLines = 1)
        }
    }
}

// What the assistant is doing or did, one line per step, with the time since
// the message started: "+0.0 s Asking big-pickle (free)…", "+7.0 s Set an alarm".
@Composable
fun StepList(steps: List<JSONObject>, modifier: Modifier = Modifier) {
    val start = steps.firstOrNull()?.optLong("at") ?: 0L
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        for (s in steps) Row {
            T("+%.1f s".format((s.optLong("at") - start) / 1000.0), 11, HColors.faint, modifier = Modifier.width(58.dp), align = androidx.compose.ui.text.style.TextAlign.End)
            Spacer(Modifier.width(8.dp))
            val text = s.optString("text")
            T(text, 12, when {
                Regex("went quiet|failed|stalled|not connected").containsMatchIn(text) -> HColors.accent
                text.startsWith("Thinking") -> HColors.faint
                else -> HColors.muted
            })
        }
    }
}
