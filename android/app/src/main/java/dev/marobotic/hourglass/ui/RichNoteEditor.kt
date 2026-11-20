package dev.marobotic.hourglass.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.util.lerp
import dev.marobotic.hourglass.R
import dev.marobotic.hourglass.core.NoteFormat
import dev.marobotic.hourglass.core.NoteLine
import dev.marobotic.hourglass.core.Run
import dev.marobotic.hourglass.data.Repo
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

// The note fonts the app carries (assets/fonts), by the name a note uses.
object NoteFonts {
    private val families = mapOf(
        "Inter" to FontFamily(Font(R.font.inter_regular, FontWeight.Normal), Font(R.font.inter_bold, FontWeight.Bold)),
        "Lora" to FontFamily(Font(R.font.lora_regular, FontWeight.Normal), Font(R.font.lora_bold, FontWeight.Bold)),
        "JetBrains Mono" to Mono,
        "Caveat" to FontFamily(Font(R.font.caveat_regular, FontWeight.Normal), Font(R.font.caveat_bold, FontWeight.Bold)),
        "Playfair Display" to FontFamily(Font(R.font.playfair_display_regular, FontWeight.Normal), Font(R.font.playfair_display_bold, FontWeight.Bold)),
    )
    fun of(name: String?): FontFamily = families[name ?: NoteFormat.FONTS[0]] ?: families.getValue(NoteFormat.FONTS[0])
}

// A note in the editor: stretches of text, with pictures and files between them.
sealed class NoteBlock {
    class Text(val rt: RichText) : NoteBlock()
    class File(val line: NoteLine) : NoteBlock()
}

fun blocksOf(md: String): MutableList<NoteBlock> {
    val out = mutableListOf<NoteBlock>()
    val pending = mutableListOf<NoteLine>()
    fun flush() { if (pending.isNotEmpty()) { out.add(NoteBlock.Text(RichText.fromLines(pending.toList()))); pending.clear() } }
    // Numbered lists show counted 1, 2, 3 (older notes may say 1, 1, 1).
    for (l in NoteFormat.renumber(NoteFormat.parse(md))) {
        if (l.kind == "image" || l.kind == "file") { flush(); out.add(NoteBlock.File(l)) } else pending.add(l)
    }
    flush()
    // Somewhere to type after the last picture.
    if (out.lastOrNull() !is NoteBlock.Text) out.add(NoteBlock.Text(RichText()))
    return out
}

fun markdownOf(blocks: List<NoteBlock>): String = NoteFormat.serialize(blocks.flatMap { b ->
    when (b) {
        is NoteBlock.File -> listOf(b.line)
        // An empty stretch (the one after a picture) is no line at all.
        is NoteBlock.Text -> if (b.rt.text.isEmpty()) emptyList() else b.rt.toLines()
    }
})

// Each character drawn in its own style; the text itself is untouched.
private class RichVisual(private val styles: List<Run>) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val b = AnnotatedString.Builder(text.text)
        var start = 0
        val n = text.text.length
        while (start < n) {
            val st = styles.getOrNull(start) ?: RichText.PLAIN
            var end = start + 1
            while (end < n && (styles.getOrNull(end) ?: RichText.PLAIN).sameStyle(st)) end++
            if (!st.sameStyle(RichText.PLAIN)) b.addStyle(spanOf(st), start, end)
            start = end
        }
        // A to-do's ☐/☑ is hidden under the themed box RichTextField draws, with
        // room after it; a done item's text is dimmed and struck through (only
        // drawn so: the note's own strike stays its own).
        var ls = 0
        while (ls <= n) {
            val le = text.text.indexOf('\n', ls).let { if (it < 0) n else it }
            val k = NoteFormat.kindOf(text.text.substring(ls, le))
            if (k.kind == "todo") {
                val g = ls + k.indent * 2
                b.addStyle(SpanStyle(color = Color.Transparent, letterSpacing = 6.sp), g, g + 1)
                if (k.checked && g + 1 < le) b.addStyle(SpanStyle(color = HColors.muted, textDecoration = TextDecoration.LineThrough), g + 1, le)
            }
            ls = le + 1
        }
        return TransformedText(b.toAnnotatedString(), OffsetMapping.Identity)
    }

    private fun spanOf(r: Run) = SpanStyle(
        fontWeight = if (r.b) FontWeight.Bold else null,
        fontStyle = if (r.i) FontStyle.Italic else null,
        fontFamily = if (r.code) Mono else if (r.font != null) NoteFonts.of(r.font) else null,
        fontSize = r.size?.sp ?: androidx.compose.ui.unit.TextUnit.Unspecified,
        textDecoration = listOfNotNull(if (r.u) TextDecoration.Underline else null, if (r.s) TextDecoration.LineThrough else null).let { if (it.isEmpty()) null else TextDecoration.combine(it) },
        color = if (r.href != null) HColors.accent else androidx.compose.ui.graphics.Color.Unspecified,
    )

    override fun equals(other: Any?) = other is RichVisual && other.styles === styles
    override fun hashCode() = System.identityHashCode(styles)
}

/** One stretch of text: typed like any text field, drawn with its styles; a tap on a to-do's box ticks it. */
@Composable
fun RichTextField(rt: RichText, placeholder: String?, onEdited: () -> Unit, onFocused: () -> Unit, modifier: Modifier = Modifier) {
    val density = LocalDensity.current
    Box(modifier) {
        // The caret is the accent (Compose's own is 1dp in the text colour);
        // selection is pinned to the app's accent too.
        NoteTextSelection {
            BasicTextField(
                rt.value,
                { if (rt.onChange(it)) onEdited() },
                Modifier.fillMaxWidth().onFocusChanged { if (it.isFocused) onFocused() },
                textStyle = TextStyle(color = HColors.fg, fontFamily = NoteFonts.of(null), fontSize = NoteFormat.DEFAULT_SIZE.sp, lineHeight = 22.sp),
                cursorBrush = SolidColor(HColors.accent),
                visualTransformation = RichVisual(rt.styles),
                onTextLayout = { rt.layout = it },
                decorationBox = { inner -> if (rt.text.isEmpty() && placeholder != null) androidx.compose.material3.Text(placeholder, color = HColors.faint, fontSize = 15.sp); inner() },
            )
        }
        // The to-dos' boxes, over their hidden ☐/☑ (the themed box: a ring,
        // flooded with the accent and a ticking check once done), each its own
        // tap target. The target is the box with 4dp of room, not 8: a wider
        // one swallowed taps meant to put the caret at the start of the item's
        // text.
        val layout = rt.layout
        if (layout != null && layout.layoutInput.text.text == rt.text) {
            for (at in rt.boxes()) {
                if (at >= rt.text.length) continue
                val done = rt.text[at].toString() == NoteFormat.CHECKED
                val r = layout.getBoundingBox(at)
                val side = with(density) { 16.dp.toPx() }
                val pad = with(density) { 4.dp.toPx() }
                // Centre the box on the text you can see. getBoundingBox is the whole
                // line (whose extra 22sp leading sits below the text), so use the
                // line's baseline and the x-height of the item's first character
                // instead; an empty item falls back to the line's middle.
                val first = at + 2
                val char = rt.text.getOrNull(first)
                val line = layout.getLineForOffset(at)
                val centreY = if (char != null && !char.isWhitespace()) {
                    val em = with(density) { (rt.styles.getOrNull(first)?.size ?: NoteFormat.DEFAULT_SIZE).toFloat().sp.toPx() }
                    layout.getLineBaseline(line) - em * 0.26f
                } else {
                    (layout.getLineTop(line) + layout.getLineBottom(line)) / 2
                }
                TodoBox(
                    done,
                    Modifier.offset { IntOffset((r.left - pad).roundToInt(), (centreY - side / 2 - pad).roundToInt()) },
                ) { rt.toggleBox(at); onEdited() }
            }
        }
    }
}

// The tick's fade-in curve: CSS's ease-out, the same as the chosen design's
// stroke-dashoffset transition.
private val EaseOut = CubicBezierEasing(0f, 0f, 0.58f, 1f)

/**
 * Maro's chosen to-do box (2026-11-20): a 16dp rounded square, a 1.5dp muted ring while
 * open, the accent red flooding in from the ring to the middle, then the white tick
 * drawing itself. The same mark as the desktop and iOS: do not restyle it without his OK.
 * Only a tap animates; loading a note and unticking show the final state at once.
 */
@Composable
private fun TodoBox(done: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    // How far the red has flooded in (0 open, 1 filled) and how much of the tick
    // is drawn (0..1). Both start at their final value: a note never flashes.
    val flood = remember { Animatable(if (done) 1f else 0f) }
    val tick = remember { Animatable(if (done) 1f else 0f) }
    var byUser by remember { mutableStateOf(false) }
    LaunchedEffect(done) {
        if (done && byUser) {
            // The fill floods in over 240ms; the tick starts 170ms in, so it draws
            // as the last of the red settles, and takes 220ms.
            launch { flood.animateTo(1f, tween(240, easing = FastOutSlowInEasing)) }
            delay(170)
            tick.animateTo(1f, tween(220, easing = EaseOut))
        } else {
            flood.snapTo(if (done) 1f else 0f)
            tick.snapTo(if (done) 1f else 0f)
        }
        byUser = false
    }
    Box(
        modifier.size(24.dp).clickable { if (!done) byUser = true; onClick() },
        contentAlignment = Alignment.Center,
    ) {
        // Clipped to the box's own 5dp corners, so a fill that reaches the edges
        // keeps them.
        Canvas(Modifier.size(16.dp).clip(RoundedCornerShape(5.dp))) {
            val corner = 5.dp.toPx()
            val ring = 1.5.dp.toPx()
            // The ring is one inset stroke whose colour and width both move with the
            // tick: muted at 1.5dp while open, the accent at 8dp (the box's middle)
            // once done, so the red floods in from the ring.
            val spread = lerp(ring, size.minDimension / 2, flood.value)
            drawRoundRect(
                androidx.compose.ui.graphics.lerp(HColors.muted, HColors.accent, flood.value),
                topLeft = Offset(spread / 2, spread / 2),
                size = Size(size.width - spread, size.height - spread),
                cornerRadius = CornerRadius((corner - spread / 2).coerceAtLeast(0f)),
                style = Stroke(spread),
            )
            if (tick.value > 0f) {
                // The tick, in a 16x16 box: its bounding box (stroke included) is
                // centred on (8, 8). Drawn along the path, as far as it has got.
                val u = size.minDimension / 16f
                val check = Path().apply {
                    moveTo(4.5f * u, 8.15f * u)
                    lineTo(7f * u, 10.75f * u)
                    lineTo(11.5f * u, 5.25f * u)
                }
                val measure = PathMeasure().apply { setPath(check, false) }
                val drawn = Path()
                measure.getSegment(0f, measure.length * tick.value, drawn, true)
                drawPath(drawn, Color.White, style = Stroke(width = 2f * u, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
        }
    }
}

/** A picture (shown, as wide as fits) or a file (a chip). Tap opens it. */
@Composable
fun NoteFileBlock(line: NoteLine, repo: Repo, opener: FileOpener, onRemove: () -> Unit) {
    val row = remember(line.fileId) { line.fileId?.let { repo.store.get("files", it) } }
    var bmp by remember(line.fileId) { mutableStateOf<ImageBitmap?>(null) }
    if (line.kind == "image" && row != null) LaunchedEffect(line.fileId) {
        repo.download(row.optString("id")) { f, _ -> if (f != null) bmp = runCatching { decodeScaled(f, 1600) }.getOrNull() }
    }
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.Top) {
        val img = bmp
        if (img != null) {
            Image(img, line.fileName, Modifier.weight(1f).heightIn(max = 420.dp).clickable { row?.let { opener.open(it) } }, contentScale = ContentScale.Fit, alignment = Alignment.CenterStart)
        } else {
            Row(
                Modifier.weight(1f).border(1.dp, HColors.border).background(HColors.surface).clickable(enabled = row != null) { row?.let { opener.open(it) } }.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (line.kind == "image") Icons.Outlined.Image else Icons.Outlined.AttachFile, null, tint = HColors.muted, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                T(if (line.kind == "image" && row != null) "Loading ${line.fileName}…" else line.fileName, 14, maxLines = 1)
            }
        }
        IconButton(onRemove, Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Take out of the note", tint = HColors.faint, modifier = Modifier.size(16.dp)) }
    }
}

/** The whole note: its stretches of text and its pictures and files, top to bottom. */
@Composable
fun RichNoteBody(blocks: List<NoteBlock>, repo: Repo, opener: FileOpener, onEdited: () -> Unit, onFocused: (RichText) -> Unit, onRemoveFile: (Int) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier) {
        blocks.forEachIndexed { n, b ->
            // Keyed by the block: taking a picture out merges the text around it,
            // and the field being written in keeps its place (and its caret)
            // instead of sliding onto a neighbour's slot.
            key(if (b is NoteBlock.Text) b.rt else b) {
                when (b) {
                    is NoteBlock.Text -> RichTextField(b.rt, if (n == 0) "Write here. Select text to make it bold, change its font or size, or start a list." else null, onEdited, { onFocused(b.rt) }, Modifier.fillMaxWidth().padding(vertical = 2.dp))
                    is NoteBlock.File -> NoteFileBlock(b.line, repo, opener) { onRemoveFile(n) }
                }
            }
        }
    }
}
