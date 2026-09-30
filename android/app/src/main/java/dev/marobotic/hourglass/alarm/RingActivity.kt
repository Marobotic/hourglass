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
import androidx.compose.foundation.background
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

// Full-screen ringing UI, shown over the lock screen.
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
        setContent {
            HourglassTheme {
                RingScreen(label, kind, onSnooze = { RingService.snooze(this) }, onDismiss = { RingService.stop(this) })
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
        val start = now
        while (true) {
            delay(1000)
            now = System.currentTimeMillis()
            if (now - start > 61_000) onDismiss() // the service gives up after a minute too
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
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            HButton("Snooze 5 min", Modifier.weight(1f).height(56.dp), onClick = onSnooze)
            HButton("Dismiss", Modifier.weight(1f).height(56.dp), primary = true, onClick = onDismiss)
        }
    }
}
