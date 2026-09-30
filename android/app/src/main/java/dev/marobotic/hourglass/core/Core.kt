package dev.marobotic.hourglass.core

import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

// Kotlin port of core/*.js. Rows stay as JSONObject so sync round-trips every
// field untouched; typed views are extension properties. core/test is the spec.

val JSONObject.id: String get() = optString("id")
val JSONObject.updatedAt: Long get() = optLong("updated_at")
val JSONObject.isDeleted: Boolean get() = optInt("deleted") == 1
fun JSONObject.str(k: String): String? = if (isNull(k) || !has(k)) null else optString(k)
fun JSONObject.bool(k: String): Boolean = optInt(k) == 1 || optBoolean(k)
fun JSONObject.ints(k: String): List<Int> = optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getInt(it) } } ?: emptyList()
fun JSONObject.strs(k: String): List<String> = optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
fun List<Int>.toJson() = JSONArray(this)

object Dates {
    val WEEKDAYS = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    fun date(s: String): LocalDate = LocalDate.parse(s)
    fun time(s: String): LocalTime {
        val (h, m) = s.split(":").map { it.toInt() }
        return LocalTime.of(h, m)
    }
    fun minutes(s: String): Int = time(s).let { it.hour * 60 + it.minute }
    fun isDate(s: String?) = s != null && Regex("""\d{4}-\d{2}-\d{2}""").matches(s) && runCatching { date(s) }.isSuccess
    fun isTime(s: String?) = s != null && Regex("""\d{1,2}:\d{2}""").matches(s) && runCatching { time(s) }.isSuccess
    fun iso(d: LocalDate): Int = d.dayOfWeek.value // 1 = Monday
    fun weekStart(d: LocalDate): LocalDate = d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    fun short(d: LocalDate) = "${WEEKDAYS[iso(d) - 1]} ${d.dayOfMonth} ${MONTHS[d.monthValue - 1]}"
    fun short(s: String) = short(date(s))
    fun long(d: LocalDate) = "${d.dayOfWeek.name.lowercase().replaceFirstChar { it.uppercase() }}, ${d.dayOfMonth} ${d.month.name.lowercase().replaceFirstChar { it.uppercase() }}"
    fun epoch(d: LocalDate, t: String, zone: ZoneId): Long = d.atTime(time(t)).atZone(zone).toInstant().toEpochMilli()
    fun local(ms: Long, zone: ZoneId) = Instant.ofEpochMilli(ms).atZone(zone)
    fun clock(ms: Long, zone: ZoneId) = local(ms, zone).let { "%02d:%02d".format(it.hour, it.minute) }
    fun pad(n: Int) = "%02d".format(n)

    fun relative(min: Long): String = when {
        min < 1 -> "now"
        min < 60 -> "in $min min"
        min < 1440 -> "in ${min / 60} h" + (if (min % 60 > 0) " ${min % 60} min" else "")
        else -> (min / 1440.0).let { Math.round(it) }.let { "in $it " + if (it == 1L) "day" else "days" }
    }
    fun left(min: Long): String = if (min < 60) "$min min left" else "${min / 60} h" + (if (min % 60 > 0) " ${min % 60} min" else "") + " left"
    fun countdown(sec: Long): String {
        val s = maxOf(0, sec)
        val h = s / 3600; val m = s % 3600 / 60; val r = s % 60
        return if (h > 0) "$h:${pad(m.toInt())}:${pad(r.toInt())}" else "$m:${pad(r.toInt())}"
    }
}

data class Occ(
    val eventId: String,
    val courseId: String?,
    val title: String,
    val kind: String,
    val location: String?,
    val color: String,
    val courseCode: String?,
    val date: LocalDate,
    val startTime: String,
    val endTime: String,
    val startMs: Long,
    val endMs: Long,
) {
    fun state(now: Long) = when {
        now < startMs -> "upcoming"
        now < endMs -> "live"
        else -> "ended"
    }
    fun progress(now: Long) = ((now - startMs).toFloat() / (endMs - startMs)).coerceIn(0f, 1f)
}

object Recurrence {
    fun dates(ev: JSONObject, from: LocalDate, to: LocalDate): List<LocalDate> {
        val start = Dates.date(ev.optString("start_date"))
        val skip = ev.strs("exceptions").toSet()
        val rep = ev.optJSONObject("repeat")
        if (rep == null) return if (!start.isBefore(from) && !start.isAfter(to) && start.toString() !in skip) listOf(start) else emptyList()
        val interval = maxOf(1, rep.optInt("interval", 1))
        val untilRaw = rep.str("until")?.let { Dates.date(it) }
        val until = if (untilRaw != null && untilRaw.isBefore(to)) untilRaw else to
        var d = if (start.isAfter(from)) start else from
        val out = mutableListOf<LocalDate>()
        when (rep.optString("freq")) {
            "daily" -> while (!d.isAfter(until)) {
                if (ChronoUnit.DAYS.between(start, d) % interval == 0L && d.toString() !in skip) out += d
                d = d.plusDays(1)
            }
            "weekly" -> {
                val days = rep.ints("days").ifEmpty { listOf(Dates.iso(start)) }
                val anchor = Dates.weekStart(start)
                while (!d.isAfter(until)) {
                    if (Dates.iso(d) in days && d.toString() !in skip &&
                        (ChronoUnit.DAYS.between(anchor, Dates.weekStart(d)) / 7) % interval == 0L) out += d
                    d = d.plusDays(1)
                }
            }
        }
        return out
    }

    fun expand(events: List<JSONObject>, courses: Map<String, JSONObject>, from: LocalDate, to: LocalDate, zone: ZoneId): List<Occ> {
        val out = mutableListOf<Occ>()
        for (ev in events) {
            if (ev.isDeleted) continue
            val course = ev.str("course_id")?.let { courses[it] }
            if (course != null && (course.isDeleted || course.bool("archived"))) continue
            val st = ev.optString("start_time")
            val et = ev.optString("end_time")
            if (!Dates.isTime(st) || !Dates.isTime(et) || !Dates.isDate(ev.optString("start_date"))) continue
            val startMin = Dates.minutes(st)
            var endMin = Dates.minutes(et)
            if (endMin <= startMin) endMin = startMin + 60
            for (d in dates(ev, from, to)) {
                val s = Dates.epoch(d, st, zone)
                out += Occ(
                    eventId = ev.id,
                    courseId = ev.str("course_id"),
                    title = ev.optString("title").ifBlank { course?.optString("name") ?: "Untitled" },
                    kind = ev.optString("kind", "event"),
                    location = ev.str("location")?.ifBlank { null } ?: course?.str("location"),
                    color = course?.optString("color") ?: "#4A8B8B",
                    courseCode = course?.str("code"),
                    date = d,
                    startTime = st,
                    endTime = et,
                    startMs = s,
                    endMs = s + (endMin - startMin) * 60_000L,
                )
            }
        }
        return out.sortedWith(compareBy({ it.startMs }, { it.title }))
    }
}

data class SessionNotes(val session: List<JSONObject>, val pinned: List<JSONObject>, val last: List<JSONObject>, val lastDate: String?)

data class NowState(
    val now: Long,
    val today: LocalDate,
    val active: Occ?,
    val next: Occ?,
    val focus: Occ?,
    val todayList: List<Occ>,
    val notes: SessionNotes,
)

object Now {
    const val EARLY = 10 * 60_000L
    const val LATE = 15 * 60_000L

    fun resolve(courses: List<JSONObject>, events: List<JSONObject>, notes: List<JSONObject>, now: Long, zone: ZoneId): NowState {
        val today = Dates.local(now, zone).toLocalDate()
        val cmap = courses.filter { !it.isDeleted }.associateBy { it.id }
        val occ = Recurrence.expand(events, cmap, today.minusDays(1), today.plusDays(7), zone)
        val active = occ.firstOrNull { now >= it.startMs && now < it.endMs }
            ?: occ.firstOrNull { now >= it.startMs - EARLY && now < it.endMs + LATE }
        val next = occ.firstOrNull { it.startMs > now && it != active }
        val focus = active ?: next?.takeIf { it.date == today }
        return NowState(now, today, active, next, focus, occ.filter { it.date == today },
            focus?.let { sessionNotes(notes, it) } ?: SessionNotes(emptyList(), emptyList(), emptyList(), null))
    }

    fun sessionNotes(notes: List<JSONObject>, occ: Occ): SessionNotes {
        val mine = notes.filter { !it.isDeleted && it.str("course_id") != null && it.str("course_id") == occ.courseId }
        val date = occ.date.toString()
        val session = mine.filter { it.str("session_date") == date && (it.str("event_id") == null || it.str("event_id") == occ.eventId) }
            .sortedByDescending { it.updatedAt }
        val pinned = mine.filter { it.bool("pinned") && it.str("session_date") != date }.sortedByDescending { it.updatedAt }
        val earlier = mine.filter { (it.str("session_date") ?: "") .let { d -> d.isNotEmpty() && d < date } && !it.bool("pinned") }
        val lastDate = earlier.maxOfOrNull { it.optString("session_date") }
        val last = if (lastDate != null) earlier.filter { it.optString("session_date") == lastDate }.sortedByDescending { it.updatedAt } else emptyList()
        return SessionNotes(session, pinned, last, lastDate)
    }
}

data class Due(val kind: String, val id: String, val at: Long, val label: String)

object Alarms {
    private const val HORIZON = 14L

    fun next(alarm: JSONObject, courses: List<JSONObject>, events: List<JSONObject>, from: Long, zone: ZoneId): Long? {
        if (alarm.isDeleted || !alarm.bool("enabled")) return null
        val today = Dates.local(from, zone).toLocalDate()
        val leadEvent = alarm.str("lead_event_id")
        val leadCourse = alarm.str("lead_course_id")
        if (leadEvent != null || leadCourse != null) {
            val evs = events.filter { !it.isDeleted && if (leadEvent != null) it.id == leadEvent else it.str("course_id") == leadCourse }
            if (evs.isEmpty()) return null
            val lead = alarm.optInt("lead_minutes", 10) * 60_000L
            val cmap = courses.filter { !it.isDeleted }.associateBy { it.id }
            return Recurrence.expand(evs, cmap, today, today.plusDays(HORIZON), zone).map { it.startMs - lead }.firstOrNull { it > from }
        }
        val t = alarm.str("time") ?: return null
        alarm.str("date")?.let { d -> return Dates.epoch(Dates.date(d), t, zone).takeIf { it > from } }
        val days = alarm.ints("days")
        for (i in 0..7) {
            val d = today.plusDays(i.toLong())
            if (days.isNotEmpty() && Dates.iso(d) !in days) continue
            val at = Dates.epoch(d, t, zone)
            if (at > from) return at
        }
        return null
    }

    fun isSpent(alarm: JSONObject, courses: List<JSONObject>, events: List<JSONObject>, from: Long, zone: ZoneId) =
        alarm.ints("days").isEmpty() && alarm.str("lead_event_id") == null && alarm.str("lead_course_id") == null && next(alarm, courses, events, from, zone) == null

    // The soonest thing that should ring after `from`: an alarm or a running timer.
    fun soonest(courses: List<JSONObject>, events: List<JSONObject>, alarms: List<JSONObject>, timers: List<JSONObject>, from: Long, zone: ZoneId): Due? {
        val out = mutableListOf<Due>()
        for (a in alarms) next(a, courses, events, from, zone)?.let { out += Due("alarm", a.id, it, a.optString("label").ifBlank { "Alarm" }) }
        for (t in timers) if (!t.isDeleted && t.optString("state") == "running" && t.optLong("ends_at") > from)
            out += Due("timer", t.id, t.optLong("ends_at"), t.optString("label").ifBlank { "Timer" })
        return out.minByOrNull { it.at }
    }
}

val PALETTE = listOf("#B14242", "#D66E36", "#F0BE66", "#4A8B8B", "#7E6BAF", "#5B8C4A", "#C2587E", "#8A8A8A")
val KINDS = listOf("lecture", "lab", "tutorial", "exam", "event")
