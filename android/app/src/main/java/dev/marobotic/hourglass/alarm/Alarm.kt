package dev.marobotic.hourglass.alarm

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import dev.marobotic.hourglass.App
import dev.marobotic.hourglass.R
import dev.marobotic.hourglass.core.Alarms
import dev.marobotic.hourglass.core.Due
import dev.marobotic.hourglass.data.Repo
import dev.marobotic.hourglass.ui.MainActivity

// One pending AlarmManager alarm at a time: the soonest alarm or timer.
// Recomputed after every change and after each ring.
object Scheduler {
    const val CHANNEL = "ringing"
    private const val REQ = 4201

    fun reschedule(ctx: Context, repo: Repo) = runCatching { schedule(ctx, repo) }

    private fun schedule(ctx: Context, repo: Repo) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val op = PendingIntent.getBroadcast(ctx, REQ, Intent(ctx, AlarmReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val due = soonest(repo, System.currentTimeMillis())
        if (due == null) {
            am.cancel(op)
            return
        }
        val show = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        // setAlarmClock rings through Doze and shows the alarm icon in the status bar.
        am.setAlarmClock(AlarmManager.AlarmClockInfo(due.at, show), op)
    }

    fun soonest(repo: Repo, from: Long): Due? =
        Alarms.soonest(repo.store.all("courses"), repo.events(), repo.alarms(), repo.timers(), from, repo.zone)

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) != null) return
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Alarms and timers", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Rings when an alarm or timer goes off"
            setSound(null, null) // RingActivity plays the alarm sound itself
            enableVibration(false)
        })
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val repo = App.repo(ctx)
        val now = System.currentTimeMillis()
        // Everything due in the last minute rings once; the first shows full screen.
        val due = mutableListOf<Due>()
        var from = now - 60_000
        while (true) {
            val d = Scheduler.soonest(repo, from) ?: break
            if (d.at > now + 2_000) break
            due += d
            from = d.at
        }
        for ((i, d) in due.withIndex()) {
            if (d.kind == "timer") repo.finishTimer(d.id)
            if (d.kind == "alarm") repo.store.get("alarms", d.id)?.let { a ->
                if (Alarms.isSpent(a, repo.store.all("courses"), repo.events(), now + 1000, repo.zone)) repo.setAlarmEnabled(d.id, false)
            }
            ring(ctx, d, i)
        }
        Scheduler.reschedule(ctx, repo)
    }

    // The first due item rings (sound + full-screen); the rest only notify.
    private fun ring(ctx: Context, d: Due, n: Int) {
        if (n == 0) { RingService.start(ctx, d.label, d.kind, d.id); return }
        Scheduler.ensureChannel(ctx)
        val notif = NotificationCompat.Builder(ctx, Scheduler.CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (d.kind == "timer") "Timer done" else "Alarm")
            .setContentText(d.label)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(d.id.hashCode(), notif)
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) { Scheduler.reschedule(ctx, App.repo(ctx)) }
}
