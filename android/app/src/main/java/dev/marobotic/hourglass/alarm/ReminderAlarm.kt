package dev.marobotic.hourglass.alarm

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import androidx.core.app.NotificationCompat
import dev.marobotic.hourglass.App
import dev.marobotic.hourglass.R
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.Reminders
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.data.Repo
import dev.marobotic.hourglass.ui.MainActivity
import org.json.JSONObject

// Reminders are not alarms: at its time a reminder shows a notification with
// Done and Snooze, on a channel that plays the chosen short tone (or none).
// One AlarmManager alarm for the soonest one; each reminder shows once per
// time it is due on this phone. Done or snoozed anywhere: the notification goes.
object ReminderAlarm {
    private const val REQ = 4301
    const val FIRE = "dev.marobotic.hourglass.REMINDER"
    const val DONE = "dev.marobotic.hourglass.REMINDER_DONE"
    const val SNOOZE = "dev.marobotic.hourglass.REMINDER_SNOOZE"
    // A reminder that became due while the phone was off shows if it is this fresh.
    private const val LATE_MS = 10 * 60_000L

    fun reschedule(ctx: Context, repo: Repo) = runCatching { schedule(ctx, repo) }

    private fun schedule(ctx: Context, repo: Repo) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val op = PendingIntent.getBroadcast(ctx, REQ, Intent(ctx, ReminderReceiver::class.java).setAction(FIRE), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val now = System.currentTimeMillis()
        val shown = shown(ctx)
        val list = repo.reminders(now)
        // Gone, done or snoozed elsewhere: take its notification down.
        val nm = ctx.getSystemService(NotificationManager::class.java)
        for (id in posted(ctx)) {
            val s = list.firstOrNull { it.first.id == id }?.second
            if (s == null || s.done || !s.overdue || (s.dueAt ?: 0) > now) { nm.cancel(noteId(id)); unpost(ctx, id) }
        }
        val next = list.mapNotNull { (r, s) -> s.dueAt?.takeIf { it > now - LATE_MS && shown[r.id] != it } }.minOrNull()
        if (next == null) { am.cancel(op); return }
        val at = maxOf(next, now + 1000)
        if (android.os.Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, op)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, op)
    }

    // Shows every reminder due now that this phone hasn't shown yet.
    fun fire(ctx: Context, repo: Repo) {
        val now = System.currentTimeMillis()
        val shown = shown(ctx)
        for ((r, s) in repo.reminders(now)) {
            val due = s.dueAt ?: continue
            if (due > now + 2_000 || due <= now - LATE_MS || shown[r.id] == due) continue
            notify(ctx, repo, r, due)
            markShown(ctx, r.id, due)
        }
        reschedule(ctx, repo)
    }

    private fun notify(ctx: Context, repo: Repo, r: JSONObject, due: Long) {
        val channel = ensureChannel(ctx, repo)
        val id = r.id
        fun action(a: String, req: Int) = PendingIntent.getBroadcast(ctx, noteId(id) + req, Intent(ctx, ReminderReceiver::class.java).setAction(a).putExtra("id", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(ctx, noteId(id), Intent(ctx, MainActivity::class.java).putExtra("open_tab", "reminders").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notif = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(r.optString("label").ifBlank { "Reminder" })
            .setContentText("Reminder · " + Dates.clock(due, repo.zone))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open)
            .setAutoCancel(false)
            .addAction(0, "Done", action(DONE, 1))
            .addAction(0, "Snooze ${repo.reminderSnooze} min", action(SNOOZE, 2))
            .build()
        runCatching { ctx.getSystemService(NotificationManager::class.java).notify(noteId(id), notif) }
        post(ctx, id)
    }

    // One channel per tone (a channel's sound is fixed once made) and a silent one.
    private fun ensureChannel(ctx: Context, repo: Repo): String {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val silent = repo.reminderStyle == "silent"
        val tone = repo.reminderTone
        val id = if (silent) "reminders_silent" else "reminders_$tone"
        if (nm.getNotificationChannel(id) != null) return id
        nm.createNotificationChannel(NotificationChannel(id, if (silent) "Reminders (silent)" else "Reminders (${tone.replaceFirstChar { it.uppercase() }})", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Shows a reminder when it is due" + if (silent) ", with no sound" else ", with a short tone"
            if (silent) { setSound(null, null); enableVibration(false) }
            else {
                setSound(Uri.parse("android.resource://${ctx.packageName}/raw/remind_$tone"), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                enableVibration(true)
            }
        })
        return id
    }

    // Settings: hear a tone.
    fun preview(ctx: Context, tone: String) {
        if (tone !in Reminders.TONES) return
        runCatching {
            val res = ctx.resources.getIdentifier("remind_$tone", "raw", ctx.packageName)
            android.media.MediaPlayer.create(ctx, res)?.apply { setOnCompletionListener { it.release() }; start() }
        }
    }

    fun cancel(ctx: Context, id: String) {
        ctx.getSystemService(NotificationManager::class.java).cancel(noteId(id))
        unpost(ctx, id)
    }

    private fun noteId(id: String) = 50_000 + (id.hashCode() and 0xFFFF) * 4

    // What this phone already showed (id -> due time) and which notifications are up.
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("reminders", Context.MODE_PRIVATE)
    private fun shown(ctx: Context): Map<String, Long> = runCatching {
        val o = JSONObject(prefs(ctx).getString("shown", "{}")!!)
        o.keys().asSequence().associateWith { o.getLong(it) }
    }.getOrDefault(emptyMap())
    private fun markShown(ctx: Context, id: String, at: Long) {
        val o = JSONObject(shown(ctx).filterValues { it > System.currentTimeMillis() - 30L * 86_400_000 }).put(id, at)
        prefs(ctx).edit().putString("shown", o.toString()).apply()
    }
    private fun posted(ctx: Context): Set<String> = prefs(ctx).getStringSet("posted", emptySet())!!.toSet()
    private fun post(ctx: Context, id: String) = prefs(ctx).edit().putStringSet("posted", posted(ctx) + id).apply()
    private fun unpost(ctx: Context, id: String) = prefs(ctx).edit().putStringSet("posted", posted(ctx) - id).apply()
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val repo = App.repo(ctx)
        val id = intent.getStringExtra("id")
        when (intent.action) {
            ReminderAlarm.FIRE -> { ReminderAlarm.fire(ctx, repo); return }
            ReminderAlarm.DONE -> if (id != null) { repo.reminderDone(id); ReminderAlarm.cancel(ctx, id) }
            ReminderAlarm.SNOOZE -> if (id != null) { repo.snoozeReminder(id); ReminderAlarm.cancel(ctx, id) }
            else -> return
        }
        // Tell the other devices before Android stops this process.
        val pending = goAsync()
        repo.syncNow().invokeOnCompletion { pending.finish() }
    }
}
