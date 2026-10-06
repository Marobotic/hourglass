package dev.marobotic.hourglass.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

// Mirrors core/test/core.test.js so the Kotlin port stays in step with the JS spec.
class CoreTest {
    private val zone = ZoneId.of("Europe/London")
    private fun at(d: String, t: String) = Dates.epoch(LocalDate.parse(d), t, zone)
    private fun d(s: String) = LocalDate.parse(s)

    private val course = JSONObject().put("id", "c1").put("name", "Algorithms").put("code", "CS201").put("color", "#B14242").put("location", "Room 4").put("archived", 0).put("deleted", 0)
    private val lecture = JSONObject().put("id", "e1").put("course_id", "c1").put("kind", "lecture").put("title", "")
        .put("start_date", "2026-09-01").put("start_time", "08:00").put("end_time", "10:00").put("deleted", 0)
        .put("repeat", JSONObject().put("freq", "weekly").put("days", JSONArray(listOf(2)))).put("exceptions", JSONArray(listOf("2026-10-27")))
    private fun note(id: String, date: String?, title: String, upd: Long, pinned: Int = 0, course: String = "c1", ev: String? = null) =
        JSONObject().put("id", id).put("course_id", course).put("session_date", date ?: JSONObject.NULL).put("event_id", ev ?: JSONObject.NULL)
            .put("title", title).put("updated_at", upd).put("pinned", pinned).put("deleted", 0)
    private val notes = listOf(
        note("n1", "2026-09-29", "today", 5, ev = "e1"), note("n2", "2026-09-22", "last week", 4),
        note("n3", "2026-09-15", "older", 3), note("n4", null, "syllabus", 2, pinned = 1), note("n5", "2026-09-29", "not mine", 9, course = "other"),
    )

    @Test fun dstSafeInstants() {
        assertEquals(2, Dates.iso(d("2026-09-29")))
        assertEquals("2026-10-20T07:00:00Z", java.time.Instant.ofEpochMilli(at("2026-10-20", "08:00")).toString())
        assertEquals("2026-10-27T08:00:00Z", java.time.Instant.ofEpochMilli(at("2026-10-27", "08:00")).toString())
        assertEquals("Tue 29 Sep", Dates.short("2026-09-29"))
    }

    @Test fun weeklyWithException() {
        assertEquals(listOf("2026-10-06", "2026-10-13", "2026-10-20", "2026-11-03"), Recurrence.dates(lecture, d("2026-10-01"), d("2026-11-05")).map { it.toString() })
    }

    @Test fun fortnightlyUntilDailyOnce() {
        val fort = JSONObject(lecture.toString()).put("exceptions", JSONArray()).put("repeat", JSONObject().put("freq", "weekly").put("interval", 2).put("days", JSONArray(listOf(2, 4))).put("until", "2026-09-30"))
        assertEquals(listOf("2026-09-01", "2026-09-03", "2026-09-15", "2026-09-17", "2026-09-29"), Recurrence.dates(fort, d("2026-09-01"), d("2026-10-31")).map { it.toString() })
        val daily = JSONObject(lecture.toString()).put("exceptions", JSONArray()).put("repeat", JSONObject().put("freq", "daily").put("interval", 3))
        assertEquals(listOf("2026-09-01", "2026-09-04", "2026-09-07"), Recurrence.dates(daily, d("2026-09-01"), d("2026-09-08")).map { it.toString() })
        val once = JSONObject(lecture.toString()).put("repeat", JSONObject.NULL).put("start_date", "2026-09-10")
        assertEquals(listOf("2026-09-10"), Recurrence.dates(once, d("2026-09-01"), d("2026-09-30")).map { it.toString() })
    }

    @Test fun duringLectureNotesSurface() {
        val r = Now.resolve(listOf(course), listOf(lecture), notes, at("2026-09-29", "08:30"), zone)
        assertEquals("Algorithms", r.active?.title)
        assertEquals("live", r.active?.state(r.now))
        assertEquals(0.25f, r.active!!.progress(r.now), 0.001f)
        assertEquals(listOf("n1"), r.notes.session.map { it.id })
        assertEquals(listOf("n4"), r.notes.pinned.map { it.id })
        assertEquals(listOf("n2"), r.notes.last.map { it.id })
        assertEquals("2026-09-22", r.notes.lastDate)
    }

    @Test fun graceWindows() {
        fun act(t: String) = Now.resolve(listOf(course), listOf(lecture), notes, at("2026-09-29", t), zone).active
        assertEquals("upcoming", act("07:52")?.state(at("2026-09-29", "07:52")))
        assertNull(act("07:45"))
        assertEquals("ended", act("10:10")?.state(at("2026-09-29", "10:10")))
        assertNull(act("10:20"))
    }

    @Test fun alarms() {
        val from = at("2026-09-28", "12:00")
        val c = listOf(course); val e = listOf(lecture)
        fun a(vararg kv: Pair<String, Any?>) = JSONObject().put("id", "a").put("enabled", 1).put("deleted", 0).put("days", JSONArray()).apply { for ((k, v) in kv) put(k, v ?: JSONObject.NULL) }
        assertEquals(at("2026-09-29", "07:00"), Alarms.next(a("time" to "07:00"), c, e, from, zone))
        assertEquals(at("2026-10-02", "09:00"), Alarms.next(a("time" to "09:00", "days" to JSONArray(listOf(5))), c, e, from, zone))
        assertNull(Alarms.next(a("time" to "09:00", "date" to "2026-09-27"), c, e, from, zone))
        assertEquals(at("2026-09-29", "07:40"), Alarms.next(a("lead_event_id" to "e1", "lead_minutes" to 20), c, e, from, zone))
        assertEquals(at("2026-09-29", "07:45"), Alarms.next(a("lead_course_id" to "c1", "lead_minutes" to 15), c, e, from, zone))
        assertNull(Alarms.next(a("time" to "07:00", "enabled" to 0), c, e, from, zone))
    }

    // Same cases as the desktop's Util.renumber.
    @Test fun notesRenumber() {
        assertEquals("1. a\n2. b\n3. c", Md.renumber("1. a\n1. b\n1. c"))
        assertEquals("1. a\n2. b\n   - sub\n   - sub2\n3. c", Md.renumber("1. a\n2. b\n   - sub\n   - sub2\n7. c"))
        assertEquals("1. a\n   1. x\n   2. y\n2. b\n   1. z", Md.renumber("1. a\n   1. x\n   1. y\n2. b\n   1. z"))
        assertEquals("1. a\n\n2. b", Md.renumber("1. a\n\n1. b"))
        assertEquals("1. a\ntext\n1. b", Md.renumber("1. a\ntext\n1. b"))
        assertEquals("5. a\n6. b", Md.renumber("5. a\n5. b"))
    }

    @Test fun notesTasksAndLists() {
        assertEquals("- [x] a\n- [ ] b", Md.toggleTask("- [ ] a\n- [ ] b", 0))
        assertEquals("- [ ] a", Md.toggleTask("- [X] a", 0))
        assertEquals("plain", Md.toggleTask("plain", 0))
        // Enter after a to-do starts an unticked one; after a number, the next number.
        assertEquals("- [x] a\n- [ ] " to 14, Md.continueList("- [x] a", 7))
        assertEquals("1. a\n2. \n3. b" to 8, Md.continueList("1. a\n2. b", 4)) // the rest counts on
        // Enter on an empty item ends the list.
        assertEquals("- a\n" to 4, Md.continueList("- a\n- ", 6))
        assertNull(Md.continueList("text", 4))
    }
}
