package dev.marobotic.hourglass.ui

import android.os.SystemClock
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

// The app's motion, in one place (the same feel as the desktop and Tasks):
// what has been on screen before, so cards pop in only the first time they
// show and glow gold when they change by themselves (a sync from another
// device, the assistant, an AI over MCP); and the little pixel burst for
// finishing things. Modifier.lively uses it per card.
object Motion {
    private val sigs = HashMap<String, String>()
    private val glowUntil = HashMap<String, Long>()
    @Volatile private var localUntil = 0L
    private var cascade = 0
    private var cascadeAt = 0L

    // Every change this phone makes (Repo's store hook): no glow for those.
    fun touchLocal() { localUntil = SystemClock.uptimeMillis() + 4000 }
    fun isLocal() = SystemClock.uptimeMillis() < localUntil
    fun known(key: String) = sigs.containsKey(key)

    // "new" the first time a key shows, "changed" when its content differs from
    // last time, "glowing" for a card rebuilt while its key is still mid-glow.
    fun track(key: String, sig: String): String {
        val old = sigs.put(key, sig)
        return when {
            old == null -> "new"
            old != sig -> { if (!isLocal()) glowUntil[key] = SystemClock.uptimeMillis() + 2300; "changed" }
            glowLeft(key) > 0 -> "glowing"
            else -> "same"
        }
    }
    fun glowLeft(key: String) = maxOf(0L, (glowUntil[key] ?: 0L) - SystemClock.uptimeMillis())
    // Cards that show together cascade: each waits a little longer.
    fun nextDelay(): Long {
        val now = SystemClock.uptimeMillis()
        if (now - cascadeAt > 90) cascade = 0
        cascadeAt = now
        return minOf(cascade++ * 45L, 420L)
    }

    // Pixel bursts, drawn over everything by BurstLayer.
    class Burst(val x: Float, val y: Float, val at: Long, val seed: Int)
    val bursts = mutableStateListOf<Burst>()
    fun burst(at: Offset) { bursts.add(Burst(at.x, at.y, SystemClock.uptimeMillis(), Random.nextInt())) }
    // A burst at the middle of something on screen.
    fun burstAt(c: LayoutCoordinates?) { c?.takeIf { it.isAttached }?.let { burst(it.positionInRoot() + Offset(it.size.width / 2f, it.size.height / 2f)) } }
}

// A card or row that pops in the first time its key shows and whose edge
// glows gold when the same key comes back with different content this phone
// didn't just change. sig: anything that changes with the content (updated_at).
@Composable
fun Modifier.lively(key: String, sig: String): Modifier = this.then(LivelyModifier(key, sig))

@Composable
private fun LivelyModifier(key: String, sig: String): Modifier {
    // Never seen: starts hidden and small, so it never flashes before popping in.
    val fresh = remember(key) { !Motion.known(key) }
    val scale = remember(key) { Animatable(if (fresh) 0.9f else 1f) }
    val alpha = remember(key) { Animatable(if (fresh) 0f else 1f) }
    val glow = remember(key) { Animatable(0f) }
    LaunchedEffect(key, sig) {
        when (Motion.track(key, sig)) {
            "new" -> {
                scale.snapTo(0.9f); alpha.snapTo(0f)
                delay(Motion.nextDelay())
                launch { alpha.animateTo(1f, tween(240)) }
                scale.animateTo(1f, spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessMediumLow))
            }
            "changed" -> if (!Motion.isLocal()) {
                launch { scale.animateTo(1.02f, tween(160)); scale.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow)) }
                glow.animateTo(1f, tween(160))
                delay(600)
                glow.animateTo(0f, tween(1500))
            }
            "glowing" -> {
                val left = Motion.glowLeft(key)
                glow.snapTo(min(1f, left / 1500f))
                glow.animateTo(0f, tween(left.toInt(), easing = LinearEasing))
            }
        }
    }
    return Modifier
        .graphicsLayer { scaleX = scale.value; scaleY = scale.value; this.alpha = alpha.value }
        .drawWithContent {
            drawContent()
            val g = glow.value
            if (g > 0f) {
                drawRect(HColors.gold.copy(alpha = 0.14f * g))
                drawRect(HColors.gold.copy(alpha = g), style = Stroke(2.dp.toPx()))
            }
        }
}

// Over the whole app: sand-coloured pixels that fly up and fall, from each burst.
@Composable
fun BurstLayer() {
    val now = remember { mutableLongStateOf(SystemClock.uptimeMillis()) }
    LaunchedEffect(Motion.bursts.size) {
        while (Motion.bursts.isNotEmpty()) {
            withFrameMillis { now.longValue = SystemClock.uptimeMillis() }
            Motion.bursts.removeAll { now.longValue - it.at > 900 }
        }
    }
    if (Motion.bursts.isEmpty()) return
    Canvas(Modifier.fillMaxSize()) {
        val px = 3.dp.toPx()
        for (b in Motion.bursts) {
            val t = (now.longValue - b.at) / 1000f
            val r = Random(b.seed)
            for (i in 0 until 16) {
                val angle = (i / 16f) * 2 * Math.PI.toFloat() + r.nextFloat() * 0.4f
                val speed = (120 + r.nextFloat() * 160) * density
                val x = b.x + cos(angle) * speed * t
                val y = b.y + sin(angle) * speed * t - 160 * density * t + 520 * density * t * t
                val fade = (1f - t / 0.9f).coerceIn(0f, 1f)
                drawRect((if (i % 3 == 0) HColors.accent else HColors.gold).copy(alpha = fade), Offset(x, y), Size(px, px))
            }
        }
    }
}
