package dev.marobotic.hourglass.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.layout.onGloballyPositioned
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
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Image
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
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
import dev.marobotic.hourglass.R
import dev.marobotic.hourglass.core.NoteFormat
import dev.marobotic.hourglass.core.NoteLine
import dev.marobotic.hourglass.core.Run
import dev.marobotic.hourglass.data.Repo
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
        // The to-dos' boxes, over their hidden ☐/☑ (the themed box: an outline,
        // filled with the accent and a check once done), each its own tap target.
        val layout = rt.layout
        if (layout != null && layout.layoutInput.text.text == rt.text) {
            for (at in rt.boxes()) {
                if (at >= rt.text.length) continue
                val done = rt.text[at].toString() == NoteFormat.CHECKED
                val r = layout.getBoundingBox(at)
                val side = with(density) { 16.dp.toPx() }
                val pad = with(density) { 8.dp.toPx() }
                var where by remember { mutableStateOf<androidx.compose.ui.layout.LayoutCoordinates?>(null) }
                Box(
                    Modifier
                        .offset { IntOffset((r.left - pad).roundToInt(), (r.top + (r.height - side) / 2 - pad).roundToInt()) }
                        .size(with(density) { (side + pad * 2).toDp() })
                        .onGloballyPositioned { where = it }
                        .clickable { if (!done) Motion.burstAt(where); rt.toggleBox(at); onEdited() },
                    contentAlignment = Alignment.Center,
                ) {
                    val boxShape = RoundedCornerShape(3.dp)
                    Box(
                        Modifier
                            .size(16.dp)
                            .background(if (done) HColors.orange else HColors.bg, boxShape)
                            .border(1.5.dp, if (done) HColors.orange else HColors.muted, boxShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (done) Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(12.dp))
                    }
                }
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
            when (b) {
                is NoteBlock.Text -> RichTextField(b.rt, if (n == 0) "Write here. Select text to make it bold, change its font or size, or start a list." else null, onEdited, { onFocused(b.rt) }, Modifier.fillMaxWidth().padding(vertical = 2.dp))
                is NoteBlock.File -> NoteFileBlock(b.line, repo, opener) { onRemoveFile(n) }
            }
        }
    }
}
