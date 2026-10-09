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
    // Recurrence maths always uses Monday weeks; the UI uses the user's first day.
    fun weekStart(d: LocalDate): LocalDate = d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    var firstDay = 6 // ISO weekday the calendar starts on (6 = Saturday)
    fun displayWeekStart(d: LocalDate): LocalDate = d.minusDays(((iso(d) - firstDay + 7) % 7).toLong())

    // Display format for stored "HH:MM" times.
    var h24 = false
    fun t(hhmm: String): String {
        val m = runCatching { minutes(hhmm) }.getOrDefault(0)
        val h = m / 60
        return if (h24) "%02d:%02d".format(h, m % 60) else "${(h + 11) % 12 + 1}:%02d %s".format(m % 60, if (h < 12) "AM" else "PM")
    }
    fun range(a: String, b: String): String {
        if (h24) return "${t(a)} – ${t(b)}"
        val same = (minutes(a) < 720) == (minutes(b) < 720)
        return (if (same) t(a).dropLast(3) else t(a)) + " – " + t(b)
    }
    fun short(d: LocalDate) = "${WEEKDAYS[iso(d) - 1]} ${d.dayOfMonth} ${MONTHS[d.monthValue - 1]}"
    fun short(s: String) = short(date(s))
    fun long(d: LocalDate) = "${d.dayOfWeek.name.lowercase().replaceFirstChar { it.uppercase() }}, ${d.dayOfMonth} ${d.month.name.lowercase().replaceFirstChar { it.uppercase() }}"
    fun epoch(d: LocalDate, t: String, zone: ZoneId): Long = d.atTime(time(t)).atZone(zone).toInstant().toEpochMilli()
    fun local(ms: Long, zone: ZoneId) = Instant.ofEpochMilli(ms).atZone(zone)
    fun clock(ms: Long, zone: ZoneId) = local(ms, zone).let { t("%02d:%02d".format(it.hour, it.minute)) }
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
    val teacher: String?,
    val date: LocalDate,
    val startTime: String,
    val endTime: String,
    val startMs: Long,
    val endMs: Long,
    // The event's own date and zone: notes, marks and skips are keyed by the
    // session date, while date/startTime/endTime are in the zone shown.
    val session: LocalDate = date,
    val eventZone: String? = null,
    val mark: String? = null, // attended | absent | off
) {
    fun state(now: Long) = when {
        now < startMs -> "upcoming"
        now < endMs -> "live"
        else -> "ended"
    }
    fun progress(now: Long) = ((now - startMs).toFloat() / (endMs - startMs)).coerceIn(0f, 1f)
}

// A course's back-to-back sessions on one day (lecture then tutorial) shown as
// one block; parts keeps the pieces.
data class Block(val first: Occ, val parts: List<Occ>) {
    val startTime get() = first.startTime
    val endTime get() = parts.last().endTime
    val startMs get() = first.startMs
    val endMs get() = parts.last().endMs
}

fun merge(list: List<Occ>): List<Block> {
    val out = mutableListOf<MutableList<Occ>>()
    for (o in list.sortedBy { it.startMs }) {
        val last = out.lastOrNull()?.last()
        val gap = if (last != null) (o.startMs - last.endMs) / 60_000 else 999
        if (last != null && last.courseId != null && last.courseId == o.courseId && last.date == o.date && gap in 0..10) out.last() += o
        else out += mutableListOf(o)
    }
    return out.map { Block(it.first(), it) }
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
            // The start date's day of the month, every step months; a month without that day (the
            // 31st, 29 Feb outside leap years) is skipped, as iCal does. Starts near `from`, so a
            // birthday entered with its real year costs nothing.
            "monthly", "yearly" -> {
                val step = interval.toLong() * if (rep.optString("freq") == "yearly") 12 else 1
                val first = start.withDayOfMonth(1)
                var n = maxOf(0L, ChronoUnit.MONTHS.between(first, d.withDayOfMonth(1)) / step - 1)
                while (true) {
                    val month = first.plusMonths(n * step)
                    if (month.isAfter(until)) break
                    if (start.dayOfMonth <= month.lengthOfMonth()) {
                        val day = month.withDayOfMonth(start.dayOfMonth)
                        if (!day.isBefore(d) && !day.isAfter(until) && day.toString() !in skip) out += day
                    }
                    n++
                }
            }
        }
        return out
    }

    // An event with its own tz keeps its times in that zone (08:00 Cairo shows
    // as 01:00 in New York); without one it floats with the shown zone.
    fun expand(events: List<JSONObject>, courses: Map<String, JSONObject>, from: LocalDate, to: LocalDate, zone: ZoneId, marks: Map<String, String> = emptyMap()): List<Occ> {
        val out = mutableListOf<Occ>()
        for (ev in events) {
            if (ev.isDeleted) continue
            val course = ev.str("course_id")?.let { courses[it] }
            if (course != null && (course.isDeleted || course.bool("archived"))) continue
            val st = ev.optString("start_time")
            val et = ev.optString("end_time")
            if (!Dates.isTime(st) || !Dates.isTime(et) || !Dates.isDate(ev.optString("start_date"))) continue
            val ez = ev.str("tz")?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: zone
            val shifted = ez.id != zone.id
            val startMin = Dates.minutes(st)
            var endMin = Dates.minutes(et)
            if (endMin <= startMin) endMin = startMin + 60
            for (d in dates(ev, if (shifted) from.minusDays(1) else from, if (shifted) to.plusDays(1) else to)) {
                val s = Dates.epoch(d, st, ez)
                val e = s + (endMin - startMin) * 60_000L
                val here = Dates.local(s, zone)
                val day = if (shifted) here.toLocalDate() else d
                if (day.isBefore(from) || day.isAfter(to)) continue
                val cid = ev.str("course_id")
                out += Occ(
                    eventId = ev.id,
                    courseId = cid,
                    title = ev.optString("title").ifBlank { course?.optString("name") ?: "Untitled" },
                    kind = ev.optString("kind", "event"),
                    location = ev.str("location")?.ifBlank { null } ?: course?.str("location"),
                    color = course?.optString("color") ?: "#4A8B8B",
                    courseCode = course?.str("code"),
                    teacher = course?.str("teacher")?.ifBlank { null },
                    date = day,
                    startTime = if (shifted) "%02d:%02d".format(here.hour, here.minute) else st,
                    endTime = if (shifted) Dates.local(e, zone).let { "%02d:%02d".format(it.hour, it.minute) } else et,
                    startMs = s,
                    endMs = e,
                    session = d,
                    eventZone = ez.id,
                    mark = marks[markId(cid, ev.id, d)],
                )
            }
        }
        return out.sortedWith(compareBy({ it.startMs }, { it.title }))
    }
}

// One mark per course and day (or per event for one without a course), the
// same id on every device.
fun markId(courseId: String?, eventId: String, date: LocalDate) = "${courseId ?: eventId}:$date"
val MARKS = listOf("attended", "absent", "off")

data class SessionNotes(val session: List<JSONObject>, val pinned: List<JSONObject>, val last: List<JSONObject>, val lastDate: String?)

data class NowState(
    val now: Long,
    val today: LocalDate,
    val active: Occ?,
    val next: Occ?,
    val focus: Occ?,
    val todayList: List<Occ>,
    val notes: SessionNotes,
    val dayOff: Boolean = active == null && next == null,
)

object Now {
    const val EARLY = 10 * 60_000L
    const val LATE = 15 * 60_000L
    // Now is about today: what is on and what comes in the next 12 hours.
    const val AHEAD = 12 * 3_600_000L

    fun resolve(courses: List<JSONObject>, events: List<JSONObject>, notes: List<JSONObject>, now: Long, zone: ZoneId, marks: Map<String, String> = emptyMap()): NowState {
        val today = Dates.local(now, zone).toLocalDate()
        val cmap = courses.filter { !it.isDeleted }.associateBy { it.id }
        val all = Recurrence.expand(events, cmap, today.minusDays(1), today.plusDays(1), zone, marks)
        val occ = all.filter { it.mark != "off" } // a day off is not happening
        val active = occ.firstOrNull { now >= it.startMs && now < it.endMs }
            ?: occ.firstOrNull { now >= it.startMs - EARLY && now < it.endMs + LATE }
        val next = occ.firstOrNull { it.startMs > now && it != active && (it.date == today || it.startMs - now <= AHEAD) }
        val focus = active ?: next?.takeIf { it.date == today }
        return NowState(now, today, active, next, focus, all.filter { it.date == today },
            focus?.let { sessionNotes(notes, it) } ?: SessionNotes(emptyList(), emptyList(), emptyList(), null))
    }

    fun sessionNotes(notes: List<JSONObject>, occ: Occ): SessionNotes {
        val mine = notes.filter { !it.isDeleted && it.str("course_id") != null && it.str("course_id") == occ.courseId }
        val date = occ.session.toString()
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

// Note Markdown rules shared with the desktop (windows/app/Hourglass/Util.qml).
object Md {
    // A to-do: "- [ ] buy milk" / "- [x] buy milk". Groups: indent, mark, text.
    val TASK = Regex("""^(\s*)[-*] \[([ xX])] ?(.*)$""")
    // Any list line. Groups: indent, marker, number (numbered items only).
    val LIST = Regex("""^(\s*)([-*] \[[ xX]] |[-*] |(\d+)\. )""")
    private val OL = Regex("""^(\s*)(\d+)\. """)

    // Numbered lists count 1, 2, 3 again: each run of "N. " lines at one indent
    // is renumbered from its first number. Deeper lines and blank lines keep the
    // run going; any other line ends it.
    fun renumber(text: String): String {
        val lines = text.split("\n").toMutableList()
        val runs = sortedMapOf<Int, Int>() // indent -> next number
        for (i in lines.indices) {
            val line = lines[i]
            if (line.isBlank()) continue
            val indent = line.length - line.trimStart().length
            runs.keys.filter { it > indent }.forEach { runs.remove(it) }
            val m = OL.find(line)
            if (m == null) { runs.remove(indent); continue }
            val n = runs.getOrPut(indent) { m.groupValues[2].toInt() }
            runs[indent] = n + 1
            lines[i] = m.groupValues[1] + n + ". " + line.substring(m.value.length)
        }
        return lines.joinToString("\n")
    }

    // Flips the to-do on line `index`. Unchanged text if that line is not one.
    fun toggleTask(text: String, index: Int): String {
        val lines = text.split("\n").toMutableList()
        val m = lines.getOrNull(index)?.let { TASK.find(it) } ?: return text
        lines[index] = lines[index].replaceFirst(Regex("""\[[ xX]]"""), if (m.groupValues[2] == " ") "[x]" else "[ ]")
        return lines.joinToString("\n")
    }

    // After typing Enter on a list line: the next line starts the next item
    // (a new to-do unticked, a number counted on). Enter on an empty item ends
    // the list instead. Returns null when the Enter was not on a list line.
    // `cursor` is where the newline was inserted in `before`.
    fun continueList(before: String, cursor: Int): Pair<String, Int>? {
        val start = before.lastIndexOf('\n', cursor - 1) + 1
        val line = before.substring(start, cursor)
        val m = LIST.find(line) ?: return null
        val rest = before.substring(cursor)
        if (line.trim() == m.groupValues[2].trim()) return before.substring(0, start) + rest.removePrefix("\n").let { if (rest.isEmpty()) "" else it } to start
        val marker = m.groupValues[2]
        val next = when {
            marker.contains('[') -> marker.replace(Regex("""\[[xX]]"""), "[ ]")
            m.groupValues[3].isNotEmpty() -> "${m.groupValues[3].toInt() + 1}. "
            else -> marker
        }
        val insert = "\n" + m.groupValues[1] + next
        val text = before.substring(0, cursor) + insert + rest
        val pos = cursor + insert.length
        return if (m.groupValues[3].isNotEmpty()) renumberKeeping(text, pos) else text to pos
    }

    // Renumbers, keeping the cursor at the same place in its line.
    fun renumberKeeping(text: String, cursor: Int): Pair<String, Int> {
        val out = renumber(text)
        if (out == text) return text to cursor
        val line = text.substring(0, cursor).count { it == '\n' }
        val col = cursor - (text.lastIndexOf('\n', cursor - 1) + 1)
        val before = text.split("\n")[line]; val after = out.split("\n")[line]
        val shift = (OL.find(after)?.value?.length ?: 0) - (OL.find(before)?.value?.length ?: 0)
        val start = out.split("\n").take(line).sumOf { it.length + 1 }
        return out to (start + (col + shift).coerceIn(0, after.length))
    }
}
