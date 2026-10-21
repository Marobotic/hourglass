package dev.marobotic.hourglass.ui

import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.marobotic.hourglass.core.id
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject

// Pictures and videos from the Drive, full screen: swipe for the next one in
// the same list. A picture is downloaded once (kept on the phone); a video
// plays while it streams from the server. "Open in app" hands it to another app.
@Composable
fun MediaViewer(o: FileOpener, list: List<JSONObject>, start: Int) {
    val pager = rememberPagerState(initialPage = start) { list.size }
    Dialog({ o.viewing = null }, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize(), beyondViewportPageCount = 1) { page ->
                val f = list[page]
                if (f.optString("mime").startsWith("video/")) VideoPage(o, f, playing = pager.currentPage == page)
                else PicturePage(o, f)
            }
            val f = list.getOrNull(pager.currentPage) ?: return@Box
            Row(
                Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.55f)).statusBarsPadding().padding(start = 16.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    T(f.optString("name"), 14, Color.White, maxLines = 1)
                    T(fmtBytes(f.optLong("size")) + if (list.size > 1) "  ·  ${pager.currentPage + 1} of ${list.size}" else "", 11, Color.White.copy(alpha = 0.7f))
                }
                IconButton({ o.viewing = null; o.openOutside(f) }) { Icon(Icons.AutoMirrored.Outlined.OpenInNew, "Open in app", tint = Color.White) }
                IconButton({ o.viewing = null }) { Icon(Icons.Outlined.Close, "Close", tint = Color.White) }
            }
        }
    }
}

@Composable
private fun PicturePage(o: FileOpener, f: JSONObject) {
    val state by produceState<Pair<ImageBitmap?, String?>?>(null, f.id) {
        value = suspendCancellableCoroutine { k ->
            o.repo.download(f.id) { file, err ->
                val bmp = file?.let { runCatching { decodeScaled(it, 2048) }.getOrNull() }
                if (k.isActive) k.resume(bmp to (if (bmp == null) err ?: "Could not show this picture" else null))
            }
        }
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val s = state
        when {
            s == null -> CircularProgressIndicator(color = HColors.accent)
            s.first != null -> Image(s.first!!, f.optString("name"), Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            else -> T(s.second ?: "", 13, Color.White.copy(alpha = 0.7f), modifier = Modifier.padding(24.dp))
        }
    }
}

@Composable
private fun VideoPage(o: FileOpener, f: JSONObject, playing: Boolean) {
    var view by remember { mutableStateOf<VideoView?>(null) }
    Box(Modifier.fillMaxSize().navigationBarsPadding(), contentAlignment = Alignment.Center) {
        AndroidView(
            factory = { ctx ->
                VideoView(ctx).apply {
                    val controls = MediaController(ctx)
                    controls.setAnchorView(this)
                    setMediaController(controls)
                    setVideoURI(Uri.parse(o.repo.rawUrl(f.id)), o.repo.authHeaders())
                    setOnPreparedListener { if (playing) start() }
                    view = this
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
    // Only the one on screen plays.
    DisposableEffect(playing, view) {
        view?.let { if (playing) it.start() else it.pause() }
        onDispose { }
    }
    DisposableEffect(Unit) { onDispose { view?.stopPlayback() } }
}
