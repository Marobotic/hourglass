package dev.marobotic.hourglass.alarm

import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
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

// Rings an alarm or timer: sound, vibration and a notification with Stop and
// Snooze. Runs as a foreground service started by the exact alarm, so it rings
// even if Android will not show the full-screen RingActivity.
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
        var ringing: Triple<String, String, String>? = null // label, kind, id
            private set

        // test: Settings > Test alarm, which plays even with the alarm sound off.
        fun start(ctx: Context, label: String, kind: String, id: String, test: Boolean = false) =
            ctx.startForegroundService(Intent(ctx, RingService::class.java).putExtra("label", label).putExtra("kind", kind).putExtra("id", id).putExtra("test", test))
        fun stop(ctx: Context) = ctx.startService(Intent(ctx, RingService::class.java).setAction(STOP))
        fun snooze(ctx: Context) = ctx.startService(Intent(ctx, RingService::class.java).setAction(SNOOZE))
    }

    private var player: MediaPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var test = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            STOP -> { finish(); return START_NOT_STICKY }
            SNOOZE -> {
                ringing?.let { App.repo(this).startTimer(5 * 60, "${it.first} (snoozed)") }
                finish(); return START_NOT_STICKY
            }
        }
        val label = intent?.getStringExtra("label") ?: "Alarm"
        val kind = intent?.getStringExtra("kind") ?: "alarm"
        val id = intent?.getStringExtra("id") ?: ""
        ringing = Triple(label, kind, id)
        test = intent?.getBooleanExtra("test", false) == true
        Scheduler.ensureChannel(this)
        val open = PendingIntent.getActivity(this, 1, Intent(this, RingActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stopPi = PendingIntent.getService(this, 2, Intent(this, RingService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
        val snoozePi = PendingIntent.getService(this, 3, Intent(this, RingService::class.java).setAction(SNOOZE), PendingIntent.FLAG_IMMUTABLE)
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
            .addAction(0, "Stop", stopPi)
            .build()
        startForeground(NOTE_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        ring()
        handler.postDelayed({ finish() }, 60_000) // give up after a minute
        return START_NOT_STICKY
    }

    private fun ring() {
        val repo = App.repo(this)
        if (repo.vibrate) getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 400), 0))
        if (!repo.sound && !test) return
        player?.release()
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                setDataSource(this@RingService, soundUri(this@RingService, repo.ringtone))
                isLooping = true
                prepare()
                start()
            }
        }.getOrNull()
    }

    private fun finish() {
        handler.removeCallbacksAndMessages(null)
        player?.run { runCatching { stop() }; release() }
        player = null
        getSystemService(Vibrator::class.java)?.cancel()
        ringing = null
        getSystemService(NotificationManager::class.java).cancel(NOTE_ID)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        sendBroadcast(Intent(RingActivity.CLOSE).setPackage(packageName))
    }

    override fun onDestroy() {
        player?.release()
        super.onDestroy()
    }
}
