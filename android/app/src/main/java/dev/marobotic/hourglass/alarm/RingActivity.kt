package dev.marobotic.hourglass.alarm

import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.input.pointer.pointerInput
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.marobotic.hourglass.App
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.ui.HButton
import dev.marobotic.hourglass.ui.HColors
import dev.marobotic.hourglass.ui.HourglassTheme
import dev.marobotic.hourglass.ui.Mono
import dev.marobotic.hourglass.ui.PixelLogo
import kotlinx.coroutines.delay

// Full-screen ringing UI over the lock screen. The sound lives in RingService;
// this screen only shows what is ringing and sends Stop or Snooze.
class RingActivity : ComponentActivity() {
    companion object { const val CLOSE = "dev.marobotic.hourglass.RING_CLOSED" }

    private val closer = object : android.content.BroadcastReceiver() {
        override fun onReceive(c: android.content.Context, i: android.content.Intent) = finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val (label, kind, _) = RingService.ringing ?: run { finish(); return }
        registerReceiver(closer, android.content.IntentFilter(CLOSE), android.content.Context.RECEIVER_NOT_EXPORTED)
        if (savedInstanceState == null) RingLog.add(this, label, "screen", "ring screen shown")
        setContent {
            HourglassTheme {
                RingScreen(label, kind, onSnooze = { RingService.snooze(this, "tapped Snooze on the ring screen") }, onDismiss = { RingService.stop(this, "held Dismiss on the ring screen") })
            }
        }
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(closer) }
        super.onDestroy()
    }
}

@Composable
private fun RingScreen(label: String, kind: String, onSnooze: () -> Unit, onDismiss: () -> Unit) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            now = System.currentTimeMillis()
        }
    }
    val wobble by rememberInfiniteTransition(label = "wobble").animateFloat(-8f, 8f, infiniteRepeatable(tween(180), RepeatMode.Reverse), label = "r")
    Column(
        Modifier.fillMaxSize().background(HColors.bg).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        PixelLogo(cell = 10.dp, modifier = Modifier.rotate(wobble))
        Spacer(Modifier.height(28.dp))
        Text(if (kind == "timer") "TIME'S UP" else "ALARM", color = HColors.accent, fontFamily = Mono, fontWeight = FontWeight.Bold, letterSpacing = 3.sp, fontSize = 13.sp)
        Spacer(Modifier.height(10.dp))
        Text(label, color = HColors.fg, fontFamily = Mono, fontWeight = FontWeight.Bold, fontSize = 28.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(Dates.clock(now, java.time.ZoneId.systemDefault()), color = HColors.muted, fontFamily = Mono, fontSize = 18.sp)
        Spacer(Modifier.height(48.dp))
        // A tap snoozes; turning it off takes a 2-second hold, which a
        // half-asleep tap does not do.
        HButton("Snooze 5 min", Modifier.fillMaxWidth().height(72.dp), primary = true, onClick = onSnooze)
        Spacer(Modifier.height(14.dp))
        HoldToDismiss(Modifier.fillMaxWidth().height(56.dp), onDismiss)
    }
}

@Composable
private fun HoldToDismiss(modifier: Modifier, onDone: () -> Unit) {
    val progress = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    var hint by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    Box(
        modifier.border(1.dp, HColors.border).pointerInput(Unit) {
            detectTapGestures(onPress = {
                hint = false
                val job = scope.launch {
                    progress.animateTo(1f, tween(2000, easing = LinearEasing))
                    if (!done) { done = true; onDone() }
                }
                tryAwaitRelease()
                if (!done) {
                    job.cancel()
                    hint = true
                    scope.launch { progress.animateTo(0f, tween(200)) }
                }
            })
        },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.align(Alignment.CenterStart).fillMaxHeight().fillMaxWidth(progress.value).background(HColors.accent.copy(alpha = 0.35f)))
        Text(if (hint) "Keep holding to dismiss" else "Hold to dismiss", color = HColors.fg, fontFamily = Mono, fontSize = 14.sp)
    }
}
