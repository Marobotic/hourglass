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
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.str
import dev.marobotic.hourglass.core.Due
import dev.marobotic.hourglass.data.Repo
import dev.marobotic.hourglass.ui.MainActivity

// One pending AlarmManager alarm at a time: the soonest alarm or timer.
// Recomputed after every change and after each ring.
object Scheduler {
    const val CHANNEL = "ringing"
    private const val REQ = 4201

    fun reschedule(ctx: Context, repo: Repo) = runCatching { schedule(ctx, repo) }.also { ReminderAlarm.reschedule(ctx, repo) }

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

    // Settings > Test alarm: a real alarm a few seconds from now, through the
    // same path as any alarm (AlarmManager through Doze, the full-screen ring,
    // the ringtone), so it shows that alarms will really go off on this phone.
    const val TEST = "dev.marobotic.hourglass.TEST_ALARM"
    fun test(ctx: Context, inSeconds: Int = 5) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val op = PendingIntent.getBroadcast(ctx, REQ + 1, Intent(ctx, AlarmReceiver::class.java).setAction(TEST), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val show = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        am.setAlarmClock(AlarmManager.AlarmClockInfo(System.currentTimeMillis() + inSeconds * 1000L, show), op)
    }

    // A wake check: 5 minutes after a wake-up alarm is dismissed it rings again,
    // unless "I'm up" is tapped in the notification first. A sleepy Dismiss
    // then still gets a second chance.
    const val WAKE = "dev.marobotic.hourglass.WAKE_CHECK"
    const val IM_UP = "dev.marobotic.hourglass.IM_UP"
    const val LOCAL_SNOOZE = "dev.marobotic.hourglass.LOCAL_SNOOZE"
    private const val WAKE_NOTE = 4203
    private const val LOCAL_SNOOZE_REQ = 4205
    private fun wakeOp(ctx: Context, label: String) =
        PendingIntent.getBroadcast(ctx, REQ + 2, Intent(ctx, AlarmReceiver::class.java).setAction(WAKE).putExtra("label", label), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    // Local-only re-ring when server can't be reached during auto-snooze (not a synced timer).
    fun localSnooze(ctx: Context, label: String, id: String, at: Long, inSeconds: Int = 300) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val op = PendingIntent.getBroadcast(ctx, LOCAL_SNOOZE_REQ, Intent(ctx, AlarmReceiver::class.java).setAction(LOCAL_SNOOZE).putExtra("label", label).putExtra("id", id).putExtra("at", at), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val show = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        am.setAlarmClock(AlarmManager.AlarmClockInfo(System.currentTimeMillis() + inSeconds * 1000L, show), op)
    }

    fun wakeCheck(ctx: Context, label: String) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val show = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        am.setAlarmClock(AlarmManager.AlarmClockInfo(System.currentTimeMillis() + 5 * 60_000L, show), wakeOp(ctx, label))
        ensureChannel(ctx)
        val up = PendingIntent.getBroadcast(ctx, REQ + 3, Intent(ctx, AlarmReceiver::class.java).setAction(IM_UP).putExtra("label", label), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notif = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Wake check in 5 min")
            .setContentText("Tap I'm up, or $label rings again.")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOngoing(true)
            .addAction(0, "I'm up", up)
            .build()
        runCatching { ctx.getSystemService(NotificationManager::class.java).notify(WAKE_NOTE, notif) }
        RingLog.add(ctx, label, "wake check", "set for 5 min from now")
    }

    fun cancelWakeCheck(ctx: Context, label: String) {
        ctx.getSystemService(AlarmManager::class.java)?.cancel(wakeOp(ctx, label))
        ctx.getSystemService(NotificationManager::class.java).cancel(WAKE_NOTE)
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
        when (intent.action) {
            Scheduler.TEST -> { start(ctx, "Test alarm", "alarm", "test", test = true); return }
            Scheduler.IM_UP -> {
                val label = intent.getStringExtra("label") ?: "Alarm"
                Scheduler.cancelWakeCheck(ctx, label)
                RingLog.add(ctx, label, "awake", "tapped I'm up: wake check cancelled")
                return
            }
            Scheduler.WAKE -> {
                val label = intent.getStringExtra("label") ?: "Alarm"
                ctx.getSystemService(NotificationManager::class.java).cancel(4203)
                RingLog.add(ctx, label, "due", "wake check: I'm up was not tapped")
                start(ctx, RingService.WAKE_PREFIX + label, "alarm", "wake-check")
                return
            }
            Scheduler.LOCAL_SNOOZE -> {
                val label = intent.getStringExtra("label") ?: "Alarm"
                val id = intent.getStringExtra("id") ?: ""
                val at = intent.getLongExtra("at", 0L)
                start(ctx, RingService.baseLabel(label) + RingService.SNOOZED, "alarm", id, at = at)
                return
            }
        }
        val pending = goAsync()
        Thread {
            try {
                handleDue(ctx)
            } finally {
                pending.finish()
            }
        }.start()
    }

    private fun handleDue(ctx: Context) {
        RingLog.settle(ctx)
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
        if (due.isEmpty()) RingLog.add(ctx, "-", "woke", "Android woke Hourglass but nothing was due (changed or deleted since it was set)")
        var ringIndex = 0
        for (d in due) {
            val late = (now - d.at) / 1000
            RingLog.add(ctx, d.label, "due", (if (d.kind == "timer") "timer" else "alarm") + " for ${Dates.clock(d.at, repo.zone)}" + if (late > 5) ", Android delivered it ${late}s late" else "")
            var wake = false
            if (d.kind == "timer") {
                // Ring a snooze timer only if the timer row is still running and not deleted after latest data
                val t = repo.store.get("timers", d.id)
                if (t == null || t.optInt("deleted") != 0 || t.optString("state") != "running") {
                    RingLog.add(ctx, d.label, "skipped", "timer was cancelled or finished on another device")
                    continue
                }
                repo.finishTimer(d.id)
                // A snoozed wake-up alarm stays a wake-up alarm.
                wake = d.label.endsWith(RingService.SNOOZED) && wakeLabels(ctx).contains(RingService.baseLabel(d.label))
            }
            if (d.kind == "alarm") repo.store.get("alarms", d.id)?.let { a ->
                if (Alarms.isSpent(a, repo.store.all("courses"), repo.events(), now + 1000, repo.zone)) repo.setAlarmEnabled(d.id, false)
                // Before a lecture, or labelled as a wake-up: gets the wake check.
                wake = a.str("lead_event_id") != null || a.str("lead_course_id") != null || d.label.contains("wake", ignoreCase = true)
                if (wake) wakeLabels(ctx, add = d.label)
            }
            val other = RingSync.stoppedElsewhere(repo, d.id, d.at)
            if (other != null) {
                RingLog.add(ctx, d.label, "skipped", "already ${other.optString("action")} on ${other.optString("device")}")
                continue
            }
            ring(ctx, d, ringIndex++, wake)
        }
        Scheduler.reschedule(ctx, repo)
    }

    private fun wakeLabels(ctx: Context, add: String? = null): Set<String> {
        val p = ctx.getSharedPreferences("ringlog", Context.MODE_PRIVATE)
        val set = p.getStringSet("wake_labels", emptySet())!!.toMutableSet()
        if (add != null && set.add(add)) p.edit().putStringSet("wake_labels", set.toList().takeLast(50).toSet()).apply()
        return set
    }

    // Starting the ring can fail (Android refuses the foreground service):
    // that is the app breaking, so it goes in the history as such.
    private fun start(ctx: Context, label: String, kind: String, id: String, test: Boolean = false, wake: Boolean = false, at: Long = 0L) {
        runCatching { RingService.start(ctx, label, kind, id, test, wake, at) }
            .onFailure { RingLog.add(ctx, label, "broke", "could not start ringing: ${it.javaClass.simpleName}: ${it.message}") }
    }

    // The first due item rings (sound + full-screen); the rest only notify.
    private fun ring(ctx: Context, d: Due, n: Int, wake: Boolean) {
        if (n == 0) { start(ctx, d.label, d.kind, d.id, wake = wake, at = d.at); return }
        RingLog.add(ctx, d.label, "notified", "another alarm was already ringing, so this one only shows a notification")
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
