package dev.marobotic.hourglass.ui

import androidx.compose.ui.graphics.RectangleShape

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDefaults
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.marobotic.hourglass.R
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

// Hourglass palette, taken from the dotrb Omarchy theme.
object HColors {
    val bg = Color(0xFF121212)
    val surface = Color(0xFF1B1B1B)
    val surface2 = Color(0xFF242424)
    val border = Color(0xFF2E2E2E)
    val fg = Color(0xFFF5F5F5)
    val muted = Color(0xFFA3A3A3)
    val faint = Color(0xFF6B6B6B)
    val accent = Color(0xFFB14242)
    val orange = Color(0xFFD66E36)
    val gold = Color(0xFFF0BE66)
    val teal = Color(0xFF4A8B8B)
}

val Mono = FontFamily(Font(R.font.jetbrains_mono_regular, FontWeight.Normal), Font(R.font.jetbrains_mono_bold, FontWeight.Bold))

fun hex(s: String?): Color = runCatching { Color(android.graphics.Color.parseColor(s)) }.getOrDefault(HColors.teal)

@Composable
fun HourglassTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = HColors.accent, onPrimary = Color.White, background = HColors.bg, onBackground = HColors.fg,
            surface = HColors.surface, onSurface = HColors.fg, surfaceVariant = HColors.surface2, onSurfaceVariant = HColors.muted,
            outline = HColors.border, secondary = HColors.gold, surfaceContainer = HColors.surface, surfaceContainerHigh = HColors.surface2,
            surfaceContainerHighest = HColors.surface2, surfaceContainerLow = HColors.surface,
        ),
        // Square everything, like Omarchy.
        shapes = androidx.compose.material3.Shapes(Square, Square, Square, Square, Square),
        typography = MaterialTheme.typography.copy(
            bodyLarge = TextStyle(fontFamily = Mono, fontSize = 15.sp),
            bodyMedium = TextStyle(fontFamily = Mono, fontSize = 14.sp),
            labelLarge = TextStyle(fontFamily = Mono, fontSize = 14.sp),
        ),
        content = content,
    )
}

private val Square = androidx.compose.foundation.shape.RoundedCornerShape(0.dp)

// --- building blocks ---

@Composable
fun T(text: String, size: Int = 14, color: Color = HColors.fg, bold: Boolean = false, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE, spacing: Double = 0.0) =
    Text(text, modifier, color = color, fontFamily = Mono, fontSize = (if (size <= 12) size + 1 else size).sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
        maxLines = maxLines, letterSpacing = spacing.sp, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)

@Composable
fun HCard(modifier: Modifier = Modifier, stripe: Color? = null, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val shape = RectangleShape
    Row(
        modifier.clip(shape).background(HColors.surface).border(1.dp, HColors.border, shape)
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .height(IntrinsicSize.Min),
    ) {
        if (stripe != null) Box(Modifier.width(4.dp).fillMaxHeight().background(stripe))
        Column(Modifier.weight(1f).padding(start = if (stripe != null) 16.dp else 14.dp, end = 14.dp, top = 14.dp, bottom = 14.dp), content = content)
    }
}

@Composable
fun HButton(text: String, modifier: Modifier = Modifier, primary: Boolean = false, icon: ImageVector? = null, danger: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val shape = RectangleShape
    val bg = when { primary -> HColors.accent; danger -> HColors.accent.copy(alpha = 0.14f); else -> Color.Transparent }
    val ink = when { primary -> Color.White; danger -> HColors.accent; else -> HColors.fg }
    Row(
        modifier.heightIn(min = 44.dp).clip(shape).background(bg).let { if (!primary && !danger) it.border(1.dp, HColors.border, shape) else it }
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = ink.copy(alpha = if (enabled) 1f else 0.4f), modifier = Modifier.size(18.dp))
            if (text.isNotEmpty()) Spacer(Modifier.width(8.dp))
        }
        if (text.isNotEmpty()) T(text, 14, ink.copy(alpha = if (enabled) 1f else 0.4f), bold = primary)
    }
}

@Composable
fun Chip(text: String, tint: Color) {
    Box(Modifier.clip(RectangleShape).background(tint.copy(alpha = 0.18f)).padding(horizontal = 7.dp, vertical = 3.dp)) {
        T(text.uppercase(), 10, tint, bold = true, spacing = 0.8)
    }
}

@Composable
fun Section(text: String, detail: String? = null, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        T(text.uppercase(), 11, HColors.muted, bold = true, spacing = 1.4)
        if (detail != null) { Spacer(Modifier.width(8.dp)); T(detail, 11, HColors.faint) }
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f).height(1.dp).background(HColors.border))
    }
}

@Composable
fun RowScope.Grow() = Spacer(Modifier.weight(1f))

private val LOGO = listOf("#########", ".#.....#.", ".#ooooo#.", "..#ooo#..", "...#o#...", "...#o#...", "..#.o.#..", ".#.ooo.#.", ".#ooooo#.", "#########")

@Composable
fun PixelLogo(cell: Dp = 3.dp, modifier: Modifier = Modifier) {
    Canvas(modifier.size(cell * 9, cell * 10)) {
        val c = size.width / 9
        for ((r, row) in LOGO.withIndex()) for ((k, ch) in row.withIndex()) {
            if (ch == '.') continue
            drawRect(if (ch == 'o') HColors.gold else HColors.accent, Offset(k * c, r * c), Size(c + 0.5f, c + 0.5f))
        }
    }
}

@Composable
fun Field(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, singleLine: Boolean = true, placeholder: String? = null, isError: Boolean = false) {
    OutlinedTextField(
        value, onChange, modifier, label = { T(label, 12, HColors.muted) }, singleLine = singleLine, isError = isError,
        placeholder = placeholder?.let { { T(it, 14, HColors.faint) } },
        textStyle = TextStyle(fontFamily = Mono, fontSize = 15.sp, color = HColors.fg),
        shape = RectangleShape,
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = HColors.fg, unfocusedBorderColor = HColors.border, cursorColor = HColors.accent,
            focusedContainerColor = HColors.bg, unfocusedContainerColor = HColors.bg),
    )
}

// A field that opens the Material time picker.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimeField(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    PickerBox(dev.marobotic.hourglass.core.Dates.t(value), label, modifier) { open = true }
    if (open) {
        val (h, m) = value.split(":").map { it.toIntOrNull() ?: 0 }.let { if (it.size == 2) it[0] to it[1] else 9 to 0 }
        val state = rememberTimePickerState(h, m, is24Hour = dev.marobotic.hourglass.core.Dates.h24)
        AlertDialog(
            onDismissRequest = { open = false },
            containerColor = HColors.surface,
            confirmButton = { TextButton({ onChange("%02d:%02d".format(state.hour, state.minute)); open = false }) { T("OK", 14, HColors.accent, bold = true) } },
            dismissButton = { TextButton({ open = false }) { T("Cancel", 14, HColors.muted) } },
            text = {
                TimePicker(state, colors = TimePickerDefaults.colors(
                    clockDialColor = HColors.surface2, selectorColor = HColors.accent, timeSelectorSelectedContainerColor = HColors.accent.copy(alpha = 0.3f),
                    timeSelectorUnselectedContainerColor = HColors.surface2, timeSelectorSelectedContentColor = HColors.fg, timeSelectorUnselectedContentColor = HColors.muted,
                ))
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(value: String?, onChange: (String?) -> Unit, label: String, modifier: Modifier = Modifier, clearable: Boolean = false) {
    var open by remember { mutableStateOf(false) }
    PickerBox(value?.let { runCatching { dev.marobotic.hourglass.core.Dates.short(it) }.getOrDefault(it) } ?: "Not set", label, modifier) { open = true }
    if (open) {
        val init = value?.let { runCatching { LocalDate.parse(it).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull() }
        val state = rememberDatePickerState(initialSelectedDateMillis = init ?: System.currentTimeMillis())
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton({ state.selectedDateMillis?.let { onChange(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }; open = false }) { T("OK", 14, HColors.accent, bold = true) }
            },
            dismissButton = {
                Row {
                    if (clearable) TextButton({ onChange(null); open = false }) { T("Clear", 14, HColors.muted) }
                    TextButton({ open = false }) { T("Cancel", 14, HColors.muted) }
                }
            },
            colors = DatePickerDefaults.colors(containerColor = HColors.surface),
        ) {
            DatePicker(state, colors = DatePickerDefaults.colors(containerColor = HColors.surface, selectedDayContainerColor = HColors.accent, todayDateBorderColor = HColors.accent, todayContentColor = HColors.accent))
        }
    }
}

@Composable
private fun PickerBox(text: String, label: String, modifier: Modifier, onClick: () -> Unit) {
    val shape = RectangleShape
    Column(modifier) {
        T(label, 11, HColors.muted, spacing = 0.6)
        Spacer(Modifier.height(4.dp))
        Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(shape).background(HColors.bg).border(1.dp, HColors.border, shape).clickable(onClick = onClick).padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart) { T(text, 15) }
    }
}

@Composable
fun DayToggles(days: List<Int>, onChange: (List<Int>) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (d in 1..7) {
            val on = d in days
            val shape = RectangleShape
            Box(Modifier.size(38.dp).clip(shape).background(if (on) HColors.accent else HColors.bg).border(BorderStroke(1.dp, if (on) HColors.accent else HColors.border), shape)
                .clickable { onChange(if (on) days - d else (days + d).sorted()) }, contentAlignment = Alignment.Center) {
                T("MTWTFSS"[d - 1].toString(), 13, if (on) Color.White else HColors.muted, bold = true)
            }
        }
    }
}

val ScreenPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp)

// Square on/off toggle (Material's Switch is a pill).
@Composable
fun Toggle(on: Boolean, onChange: (Boolean) -> Unit) {
    Box(Modifier.size(width = 44.dp, height = 24.dp).background(if (on) HColors.accent else HColors.surface2).border(1.dp, HColors.border).clickable { onChange(!on) }) {
        Box(Modifier.padding(3.dp).size(18.dp).align(if (on) Alignment.CenterEnd else Alignment.CenterStart).background(if (on) Color.White else HColors.muted))
    }
}
