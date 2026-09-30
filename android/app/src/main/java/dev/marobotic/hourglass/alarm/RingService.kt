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
class RingService : Service() {
    companion object {
        const val STOP = "dev.marobotic.hourglass.STOP"
        const val SNOOZE = "dev.marobotic.hourglass.SNOOZE"
        private const val NOTE_ID = 4202
        var ringing: Triple<String, String, String>? = null // label, kind, id
            private set

        fun start(ctx: Context, label: String, kind: String, id: String) =
            ctx.startForegroundService(Intent(ctx, RingService::class.java).putExtra("label", label).putExtra("kind", kind).putExtra("id", id))
        fun stop(ctx: Context) = ctx.startService(Intent(ctx, RingService::class.java).setAction(STOP))
        fun snooze(ctx: Context) = ctx.startService(Intent(ctx, RingService::class.java).setAction(SNOOZE))
    }

    private var player: MediaPlayer? = null
    private val handler = Handler(Looper.getMainLooper())

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
        if (!repo.sound) return
        player?.release()
        val res = resources.getIdentifier("ring_${repo.ringtone}", "raw", packageName).takeIf { it != 0 } ?: R.raw.ring_classic
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                setDataSource(this@RingService, Uri.parse("android.resource://$packageName/$res"))
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
