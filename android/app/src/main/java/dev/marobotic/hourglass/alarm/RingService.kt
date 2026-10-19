package dev.marobotic.hourglass.alarm

import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import dev.marobotic.hourglass.App
import dev.marobotic.hourglass.R

// Rings an alarm or timer: sound, vibration and a notification with Snooze.
// Runs as a foreground service started by the exact alarm, so it rings even if
// Android will not show the full-screen RingActivity. Every ring and how it
// ended goes into RingLog (Settings > Alarm history).
// A built-in ringtone ships in res/raw; uploads and songs are synced files.
fun soundUri(ctx: Context, id: String): Uri {
    val file = App.repo(ctx).soundFile(id)
    if (file.exists()) return Uri.fromFile(file)
    val res = ctx.resources.getIdentifier("ring_$id", "raw", ctx.packageName).takeIf { it != 0 } ?: R.raw.ring_classic
    return Uri.parse("android.resource://${ctx.packageName}/$res")
}

// Plays a ringtone once in Settings; a second tap on the same one stops it.
object Preview {
    private var player: MediaPlayer? = null
    var playing: String? = null
        private set

    fun toggle(ctx: Context, id: String) {
        val same = playing == id
        stop()
        if (same) return
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                setDataSource(ctx, soundUri(ctx, id))
                setOnCompletionListener { stop() }
                prepare()
                start()
            }
        }.getOrNull()
        playing = if (player != null) id else null
    }

    fun stop() {
        player?.run { runCatching { stop() }; release() }
        player = null
        playing = null
    }
}

class RingService : Service() {
    companion object {
        const val STOP = "dev.marobotic.hourglass.STOP"
        const val SNOOZE = "dev.marobotic.hourglass.SNOOZE"
        private const val NOTE_ID = 4202
        const val RING_MS = 10 * 60_000L // rings this long, then snoozes by itself
        private const val AUTO_SNOOZES = 3 // then it gives up
        const val SNOOZED = " (snoozed)"
        const val WAKE_PREFIX = "Are you up? "
        var ringing: Triple<String, String, String>? = null // label, kind, id
            private set

        // test: Settings > Test alarm, which plays even with the alarm sound off.
        // wake: a wake-up alarm; dismissing it sets a wake check 5 minutes later.
        // at: the occurrence ringing, so other devices can tell it was stopped.
        fun start(ctx: Context, label: String, kind: String, id: String, test: Boolean = false, wake: Boolean = false, at: Long = 0L) =
            ctx.startForegroundService(Intent(ctx, RingService::class.java).putExtra("label", label).putExtra("kind", kind).putExtra("id", id).putExtra("test", test).putExtra("wake", wake).putExtra("at", at))
        // via: what stopped it, for the alarm history.
        fun stop(ctx: Context, via: String) = ctx.startService(Intent(ctx, RingService::class.java).setAction(STOP).putExtra("via", via))
        fun snooze(ctx: Context, via: String) = ctx.startService(Intent(ctx, RingService::class.java).setAction(SNOOZE).putExtra("via", via))

        fun baseLabel(label: String) = label.removePrefix(WAKE_PREFIX).removeSuffix(SNOOZED)
    }

    private var player: MediaPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var test = false
    private var wake = false
    private var startedAt = 0L
    private var savedVolume: Int? = null
    private var ringAt = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    private fun secs() = (System.currentTimeMillis() - startedAt) / 1000

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val via = intent?.getStringExtra("via") ?: "unknown"
        when (intent?.action) {
            STOP -> {
                ringing?.let { r ->
                    RingLog.add(this, r.first, "dismissed", "$via after ${secs()}s")
                    autoSnoozes(baseLabel(r.first), reset = true)
                    RingSync.share(App.repo(this), r.third, ringAt, "dismissed")
                    if (wake) Scheduler.wakeCheck(this, baseLabel(r.first))
                }
                finish(); return START_NOT_STICKY
            }
            SNOOZE -> {
                ringing?.let { r ->
                    RingLog.add(this, r.first, "snoozed", "$via after ${secs()}s, rings again in 5 min")
                    autoSnoozes(baseLabel(r.first), reset = true)
                    RingSync.share(App.repo(this), r.third, ringAt, "snoozed")
                    snoozeTimer(r)
                }
                finish(); return START_NOT_STICKY
            }
        }
        // A new ring while one is going replaces it: say so.
        ringing?.let { RingLog.add(this, it.first, "replaced", "another alarm started ringing after ${secs()}s") }
        RingLog.settle(this)
        val label = intent?.getStringExtra("label") ?: "Alarm"
        val kind = intent?.getStringExtra("kind") ?: "alarm"
        val id = intent?.getStringExtra("id") ?: ""
        test = intent?.getBooleanExtra("test", false) == true
        wake = intent?.getBooleanExtra("wake", false) == true
        ringAt = intent?.getLongExtra("at", 0L) ?: 0L
        startedAt = System.currentTimeMillis()
        ringing = Triple(label, kind, id)
        RingLog.opened(this, label)
        Scheduler.ensureChannel(this)
        val open = PendingIntent.getActivity(this, 1, Intent(this, RingActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val snoozePi = PendingIntent.getService(this, 3, Intent(this, RingService::class.java).setAction(SNOOZE).putExtra("via", "Snooze in the notification"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        // No Stop in the notification: one sleepy tap there would end it. Dismiss
        // is a 2-second hold on the ring screen, which the notification opens.
        val notif = NotificationCompat.Builder(this, Scheduler.CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (kind == "timer") "Timer done" else "Alarm")
            .setContentText(label)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setFullScreenIntent(open, true)
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(0, "Snooze 5 min", snoozePi)
            .build()
        startForeground(NOTE_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        ring(label)
        handler.postDelayed({ ringOut() }, RING_MS)
        if (ringAt != 0L && !test) watchOtherDevices()
        return START_NOT_STICKY
    }

    // Nobody answered in 10 minutes: snooze by itself, up to 3 times.
    private fun ringOut() {
        val r = ringing ?: return
        val base = baseLabel(r.first)
        val n = autoSnoozes(base)
        if (r.second == "alarm" && !test && n < AUTO_SNOOZES) {
            autoSnoozes(base, set = n + 1)
            RingLog.add(this, r.first, "auto-snoozed", "nobody answered for ${RING_MS / 60_000} min, rings again in 5 min (${n + 1} of $AUTO_SNOOZES)")
            snoozeTimer(r)
        } else {
            autoSnoozes(base, reset = true)
            RingLog.add(this, r.first, "rang out", "nobody answered for ${RING_MS / 60_000} min" + if (r.second == "alarm" && !test) ", after $AUTO_SNOOZES snoozes" else "")
        }
        finish()
    }

    private fun snoozeTimer(r: Triple<String, String, String>) =
        App.repo(this).startTimer(5 * 60, baseLabel(r.first) + SNOOZED, id = if (ringAt != 0L) RingSync.snoozeId(r.third, ringAt) else null)

    // Every 5 seconds while ringing: sync, and stop if another device did.
    private fun watchOtherDevices() {
        val r = ringing ?: return
        Thread {
            val repo = App.repo(this)
            runCatching { repo.syncBlocking() }
            val other = RingSync.stoppedElsewhere(repo, r.third, ringAt)
            handler.post {
                if (ringing != r) return@post
                if (other != null && other.optString("device") != RingSync.DEVICE) {
                    val action = if (other.optString("action") == "snoozed") "snoozed" else "dismissed"
                    RingLog.add(this, r.first, action, "on ${other.optString("device")} after ${secs()}s")
                    autoSnoozes(baseLabel(r.first), reset = true)
                    finish()
                } else handler.postDelayed({ watchOtherDevices() }, 5000)
            }
        }.start()
    }

    private fun autoSnoozes(base: String, set: Int? = null, reset: Boolean = false): Int {
        val p = getSharedPreferences("ringlog", MODE_PRIVATE)
        val key = "auto:$base"
        if (reset) p.edit().remove(key).apply()
        if (set != null) p.edit().putInt(key, set).apply()
        return p.getInt(key, 0)
    }

    private fun player(uri: Uri) = MediaPlayer().apply {
        setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        setDataSource(this@RingService, uri)
        isLooping = true
        setVolume(0.3f, 0.3f)
        prepare()
        start()
    }

    private fun ring(label: String) {
        val repo = App.repo(this)
        // Alarm usage: vibrates in silent mode too, like the Clock app.
        if (repo.vibrate) getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 400), 0),
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
        if (!repo.sound && !test) {
            RingLog.add(this, label, "ringing", "alarm sound is off in Settings: " + if (repo.vibrate) "vibrating only" else "vibrate is off too, nothing to hear or feel")
            return
        }
        // Alarm volume all the way up while it rings (put back after); the
        // sound itself starts at 30% and rises to full over the first minute.
        val am = getSystemService(AudioManager::class.java)
        val was = am?.getStreamVolume(AudioManager.STREAM_ALARM) ?: -1
        val max = am?.getStreamMaxVolume(AudioManager.STREAM_ALARM) ?: -1
        if (am != null && was < max && runCatching { am.setStreamVolume(AudioManager.STREAM_ALARM, max, 0) }.isSuccess) savedVolume = was
        player?.release()
        var error: Throwable? = null
        player = runCatching { player(soundUri(this, repo.ringtone)) }.onFailure { error = it }.getOrNull()
        if (player == null) {
            // The chosen sound would not play: the built-in one instead.
            player = runCatching { player(Uri.parse("android.resource://$packageName/${R.raw.ring_classic}")) }.getOrNull()
            RingLog.add(this, label, "no sound", "the ringtone would not play (${error?.message ?: "unknown error"})" + if (player != null) ", played Classic instead" else ", Classic failed too")
            if (player == null) return
        }
        val vol = if (am == null) "?" else "${am.getStreamVolume(AudioManager.STREAM_ALARM)}/$max" + if (savedVolume != null) " (raised from $was)" else ""
        RingLog.add(this, label, "ringing", "sound playing, alarm volume $vol" + if (repo.vibrate) ", vibrating" else "")
        var step = 0
        handler.post(object : Runnable {
            override fun run() {
                val p = player ?: return
                step++
                val v = minOf(1f, 0.3f + 0.7f * step / 60f)
                runCatching { p.setVolume(v, v) }
                if (v < 1f) handler.postDelayed(this, 1000)
            }
        })
    }

    private fun restoreVolume() {
        savedVolume?.let { v -> runCatching { getSystemService(AudioManager::class.java)?.setStreamVolume(AudioManager.STREAM_ALARM, v, 0) } }
        savedVolume = null
    }

    private fun finish() {
        RingLog.closed(this)
        handler.removeCallbacksAndMessages(null)
        player?.run { runCatching { stop() }; release() }
        player = null
        restoreVolume()
        getSystemService(Vibrator::class.java)?.cancel()
        ringing = null
        getSystemService(NotificationManager::class.java).cancel(NOTE_ID)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        sendBroadcast(Intent(RingActivity.CLOSE).setPackage(packageName))
    }

    override fun onDestroy() {
        // Android stopped the service while it was still ringing.
        ringing?.let {
            RingLog.add(this, it.first, "broke", "Android stopped the ring after ${secs()}s with no button pressed")
            RingLog.closed(this)
            ringing = null
        }
        player?.release()
        restoreVolume()
        super.onDestroy()
    }
}
