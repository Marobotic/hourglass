package dev.marobotic.hourglass.ui

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Check
import androidx.compose.foundation.layout.size
import dev.marobotic.hourglass.core.Md
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Attachments are a line of their own: ![name](hgfile:<id>) is a picture,
// [name](hgfile:<id>) a file - the same form the desktop writes.
private val IMG = Regex("""^\s*!\[([^\]]*)]\(hgfile:([0-9a-f-]{36})\)\s*$""")
private val FILE = Regex("""^\s*\[([^\]]*)]\(hgfile:([0-9a-f-]{36})\)\s*$""")
private val INLINE = Regex("""\*\*(.+?)\*\*|<u>(.+?)</u>|~~(.+?)~~|\*(.+?)\*|\[([^\]]+)]\([^)]+\)""")

// **bold**, *italic*, <u>underline</u>, ~~strike~~, [links] as their text.
fun inlineMd(s: String): AnnotatedString = buildAnnotatedString {
    var i = 0
    for (m in INLINE.findAll(s)) {
        append(s.substring(i, m.range.first))
        val g = m.groupValues
        when {
            g[1].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(inlineMd(g[1])) }
            g[2].isNotEmpty() -> withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) { append(inlineMd(g[2])) }
            g[3].isNotEmpty() -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(inlineMd(g[3])) }
            g[4].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(inlineMd(g[4])) }
            else -> withStyle(SpanStyle(color = HColors.accent)) { append(g[5]) }
        }
        i = m.range.last + 1
    }
    append(s.substring(i))
}

// A note as it reads: headings, lists counted 1, 2, 3, to-dos with boxes to
// tick, inline styles, and its pictures and files. onToggleTask gets the line
// of the note a ticked box is on; without it the boxes only show.
@Composable
fun NoteView(body: String, opener: FileOpener, modifier: Modifier = Modifier, onToggleTask: ((Int) -> Unit)? = null) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        // Renumbering keeps every line where it is, so indexes still match the body.
        for ((index, line) in Md.renumber(body).split("\n").withIndex()) {
            val img = IMG.find(line)
            val file = FILE.find(line)
            val task = Md.TASK.find(line)
            when {
                task != null -> TaskRow(task.groupValues[1].length, task.groupValues[2] != " ", task.groupValues[3], onToggleTask?.let { cb -> { cb(index) } })
                img != null -> NotePicture(img.groupValues[2], img.groupValues[1], opener)
                file != null -> FileChip(file.groupValues[1].removePrefix("📎").trim()) {
                    opener.repo.store.get("files", file.groupValues[2])?.let { opener.open(it) } ?: run { opener.error = "That file is no longer in the Drive." }
                }
                line.isBlank() -> Spacer(Modifier.height(4.dp))
                else -> {
                    val h = Regex("^(#{1,6}) (.*)").find(line)
                    val ul = Regex("^(\\s*)[-*] (.*)").find(line)
                    val ol = Regex("^(\\s*)(\\d+)\\. (.*)").find(line)
                    when {
                        h != null -> Text(inlineMd(h.groupValues[2]), color = HColors.fg, fontFamily = Mono, fontWeight = FontWeight.Bold,
                            fontSize = when (h.groupValues[1].length) { 1 -> 24.sp; 2 -> 20.sp; else -> 17.sp })
                        ul != null -> Row(Modifier.padding(start = (ul.groupValues[1].length * 6).dp)) { Text("•  ", color = HColors.muted, fontFamily = Mono, fontSize = 15.sp); Text(inlineMd(ul.groupValues[2]), color = HColors.fg, fontFamily = Mono, fontSize = 15.sp, lineHeight = 22.sp) }
                        ol != null -> Row(Modifier.padding(start = (ol.groupValues[1].length * 6).dp)) { Text(ol.groupValues[2] + ". ", color = HColors.muted, fontFamily = Mono, fontSize = 15.sp); Text(inlineMd(ol.groupValues[3]), color = HColors.fg, fontFamily = Mono, fontSize = 15.sp, lineHeight = 22.sp) }
                        else -> Text(inlineMd(line), color = HColors.fg, fontFamily = Mono, fontSize = 15.sp, lineHeight = 22.sp)
                    }
                }
            }
        }
    }
}

// One to-do: a square box (filled and ticked when done), then the item.
@Composable
private fun TaskRow(indent: Int, done: Boolean, text: String, onToggle: (() -> Unit)?) {
    Row(Modifier.padding(start = (indent * 6).dp), verticalAlignment = Alignment.Top) {
        Box(
            Modifier.padding(top = 2.dp).size(20.dp)
                .background(if (done) HColors.accent else androidx.compose.ui.graphics.Color.Transparent)
                .border(1.dp, if (done) HColors.accent else HColors.muted)
                .then(if (onToggle != null) Modifier.clickable(onClick = onToggle) else Modifier),
            contentAlignment = Alignment.Center,
        ) { if (done) Icon(Icons.Outlined.Check, "Done", tint = HColors.bg, modifier = Modifier.size(15.dp)) }
        Spacer(Modifier.width(10.dp))
        Text(
            inlineMd(text), fontFamily = Mono, fontSize = 15.sp, lineHeight = 22.sp,
            color = if (done) HColors.muted else HColors.fg,
            textDecoration = if (done) TextDecoration.LineThrough else null,
        )
    }
}

@Composable
private fun NotePicture(id: String, name: String, opener: FileOpener) {
    var bmp by remember(id) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember(id) { mutableStateOf(false) }
    LaunchedEffect(id) {
        if (opener.repo.store.get("files", id) == null) { failed = true; return@LaunchedEffect }
        opener.repo.download(id) { f, _ -> if (f != null) bmp = runCatching { decodeScaled(f, 1600) }.getOrNull(); if (bmp == null) failed = true }
    }
    val b = bmp
    when {
        b != null -> Image(b, name, Modifier.fillMaxWidth().heightIn(max = 420.dp).clickable { opener.repo.store.get("files", id)?.let { opener.open(it) } }, contentScale = ContentScale.Fit, alignment = Alignment.CenterStart)
        failed -> FileChip(name) { opener.repo.store.get("files", id)?.let { opener.open(it) } }
        else -> Box(Modifier.fillMaxWidth().height(120.dp).background(HColors.surface), contentAlignment = Alignment.Center) { T("Loading picture…", 12, HColors.faint) }
    }
}

@Composable
private fun FileChip(name: String, onClick: () -> Unit) {
    Row(
        Modifier.border(1.dp, HColors.border).background(HColors.surface).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.AttachFile, null, tint = HColors.muted, modifier = Modifier.height(18.dp))
        Spacer(Modifier.width(8.dp))
        T(name, 14, maxLines = 1)
    }
}
