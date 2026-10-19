package dev.marobotic.hourglass.alarm

import android.content.Context
import org.json.JSONObject
import java.io.File

// What every alarm did on this phone, so a missed alarm shows whether it rang
// and how it ended: a person (Dismiss held, Snooze tapped), nobody answering,
// or the ring breaking (it never started, or it stopped with no button pressed).
// One JSON object per line in files/ring-log.jsonl; the last 300 lines are kept.
// Settings > Alarm history shows it.
object RingLog {
    private const val FILE = "ring-log.jsonl"
    private const val KEEP = 300
    private const val OPEN = "ring_open" // the ring in progress: "<started ms>|<label>"

    data class Entry(val at: Long, val label: String, val event: String, val detail: String) {
        // Something went wrong in the app, not a person's choice.
        val broke get() = event == "broke" || event == "no sound"
    }

    @Synchronized
    fun add(ctx: Context, label: String, event: String, detail: String = "") {
        android.util.Log.i("HourglassRing", "$event | $label | $detail")
        runCatching {
            val f = File(ctx.filesDir, FILE)
            val line = JSONObject().put("at", System.currentTimeMillis()).put("label", label).put("event", event).put("detail", detail).toString()
            val old = if (f.exists()) f.readLines().filter { it.isNotBlank() } else emptyList()
            f.writeText((old.takeLast(KEEP - 1) + line).joinToString("\n") + "\n")
        }
    }

    fun read(ctx: Context): List<Entry> {
        settle(ctx)
        val f = File(ctx.filesDir, FILE)
        if (!f.exists()) return emptyList()
        return f.readLines().mapNotNull { l ->
            runCatching { JSONObject(l).let { Entry(it.getLong("at"), it.optString("label"), it.optString("event"), it.optString("detail")) } }.getOrNull()
        }.reversed()
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("ringlog", Context.MODE_PRIVATE)

    // A ring started: remembered until it ends with an outcome.
    fun opened(ctx: Context, label: String) = prefs(ctx).edit().putString(OPEN, "${System.currentTimeMillis()}|$label").commit()

    // It ended with an outcome (dismissed, snoozed, ...).
    fun closed(ctx: Context) = prefs(ctx).edit().remove(OPEN).commit()

    // A ring that was open while nothing is ringing in this process any more was
    // cut off: the app was killed or crashed mid-ring. Logged once.
    @Synchronized
    fun settle(ctx: Context) {
        if (RingService.ringing != null) return
        val open = prefs(ctx).getString(OPEN, null) ?: return
        closed(ctx)
        val started = open.substringBefore('|').toLongOrNull() ?: 0L
        val secs = (System.currentTimeMillis() - started) / 1000
        add(ctx, open.substringAfter('|'), "broke", "the ring stopped with no button pressed: Android closed the app or it crashed (found ${secs}s after it started)")
    }
}

// Dismissed or snoozed on one device = stopped on all of them. The action is a
// synced pref row per alarm ("ring_stop:<alarm id>"); a ringing device syncs
// every few seconds and stops when it sees one for the occurrence it rings.
object RingSync {
    val DEVICE: String = android.os.Build.MODEL ?: "phone"
    private fun key(id: String) = "ring_stop:$id"

    fun stoppedElsewhere(repo: dev.marobotic.hourglass.data.Repo, id: String, at: Long): JSONObject? = runCatching {
        val v = repo.store.get("prefs", key(id))?.takeIf { it.optInt("deleted") == 0 }?.optString("value") ?: return null
        JSONObject(v).takeIf { it.optLong("at") == at }
    }.getOrNull()

    fun share(repo: dev.marobotic.hourglass.data.Repo, id: String, at: Long, action: String) {
        if (id == "test" || id == "wake-check" || at == 0L) return
        repo.store.upsert("prefs", mapOf("value" to JSONObject().put("at", at).put("action", action).put("device", DEVICE).put("ts", System.currentTimeMillis()).toString()), key(id))
        Thread { runCatching { repo.syncBlocking() } }.start()
    }

    // One snooze timer per ring, whichever device snoozes (the desktop makes the same id).
    fun snoozeId(id: String, at: Long) = java.util.UUID.nameUUIDFromBytes("snooze:$id:$at".toByteArray()).toString()
}
