package dev.marobotic.hourglass.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.marobotic.hourglass.data.Repo
import dev.marobotic.hourglass.data.Upload

// Uploads, like Google Drive's: a box at the bottom while files go up, one
// row per file with its name, a progress bar, how much has gone and how fast.
// A file can be cancelled while it goes; the box folds down to its header and
// closes once everything is done. Any upload shows here: the Drive's, a
// note's pictures, the assistant's attachments.
@Composable
fun UploadPanel(repo: Repo, modifier: Modifier = Modifier) {
    val items by repo.uploads.collectAsState()
    var folded by remember { mutableStateOf(false) }
    var closed by remember { mutableStateOf(true) }
    val sending = items.count { it.state == "sending" }
    // A new upload opens the box again.
    LaunchedEffect(sending) { if (sending > 0) closed = false }
    AnimatedVisibility(!closed && items.isNotEmpty(), modifier, enter = fadeIn() + slideInVertically { it / 3 }, exit = fadeOut() + slideOutVertically { it / 3 }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).border(1.dp, HColors.border).background(HColors.surface)) {
            // Header: what is going on, fold, close.
            val done = items.count { it.state == "done" }
            val bad = items.size - done - sending
            val title = if (sending > 0) "Uploading $sending ${if (sending == 1) "file" else "files"}"
                else listOfNotNull(if (done > 0) "$done ${if (done == 1) "upload" else "uploads"} complete" else null, if (bad > 0) "$bad not uploaded" else null).joinToString(" · ")
            Column(Modifier.background(HColors.surface2)) {
                Row(Modifier.fillMaxWidth().clickable { folded = !folded }.padding(start = 14.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (sending > 0) Icons.Outlined.CloudUpload else Icons.Outlined.Check, null, tint = if (sending > 0) HColors.accent else HColors.teal, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                    T(title, 14, bold = true, maxLines = 1, modifier = Modifier.weight(1f))
                    IconButton({ folded = !folded }) { Icon(if (folded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, if (folded) "Show the files" else "Fold down", tint = HColors.muted) }
                    if (sending == 0) IconButton({ closed = true; repo.clearUploads() }) { Icon(Icons.Outlined.Close, "Close", tint = HColors.muted) }
                }
                // All the files still going: one bar for the header.
                if (sending > 0) {
                    val going = items.filter { it.state == "sending" && it.size > 0 }
                    val all = going.sumOf { it.size }.coerceAtLeast(1)
                    Bar(going.sumOf { it.sent }.toFloat() / all, HColors.accent, Modifier.height(2.dp))
                }
            }
            if (!folded) LazyColumn(Modifier.heightIn(max = 260.dp)) {
                items(items, key = { it.id }) { u -> UploadRow(u) { repo.cancelUpload(u.id) } }
            }
        }
    }
}

@Composable
private fun UploadRow(u: Upload, onCancel: () -> Unit) {
    val going = u.state == "sending"
    Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        val picture = Regex("""\.(png|jpe?g|gif|webp|bmp|heic)$""", RegexOption.IGNORE_CASE).containsMatchIn(u.name)
        Icon(if (picture) Icons.Outlined.Image else Icons.Outlined.InsertDriveFile, null, tint = HColors.muted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            T(u.name, 13, maxLines = 1)
            Spacer(Modifier.height(6.dp))
            val part = when { u.state == "done" -> 1f; u.size > 0 -> (u.sent.toFloat() / u.size).coerceIn(0f, 1f); else -> 0f }
            Bar(part, when (u.state) { "done" -> HColors.teal; "sending" -> HColors.accent; else -> HColors.faint }, Modifier.height(3.dp))
            Spacer(Modifier.height(5.dp))
            T(when {
                going && u.size > 0 && u.sent >= u.size -> "${fmtBytes(u.size)}  ·  finishing…"
                going -> (if (u.size > 0) "${fmtBytes(u.sent)} of ${fmtBytes(u.size)}" else fmtBytes(u.sent)) + (if (u.speed > 0) "  ·  ${fmtBytes(u.speed)}/s" else "")
                u.state == "done" -> "${fmtBytes(u.size.coerceAtLeast(u.sent))}  ·  uploaded"
                u.state == "cancelled" -> "Cancelled"
                else -> u.error ?: "Not uploaded"
            }, 11, if (u.state == "failed") HColors.accent else HColors.muted, maxLines = 1)
        }
        Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
            if (going) IconButton(onCancel) { Icon(Icons.Outlined.Close, "Cancel this upload", tint = HColors.muted, modifier = Modifier.size(18.dp)) }
            if (u.state == "done") Icon(Icons.Outlined.Check, null, tint = HColors.teal, modifier = Modifier.size(18.dp))
        }
    }
}

// A thin progress bar that slides to its new length.
@Composable
private fun Bar(part: Float, color: androidx.compose.ui.graphics.Color, modifier: Modifier) {
    val shown by animateFloatAsState(part, label = "upload")
    Box(modifier.fillMaxWidth().background(HColors.surface2)) {
        Box(Modifier.fillMaxWidth(shown).fillMaxHeight().background(color))
    }
}
