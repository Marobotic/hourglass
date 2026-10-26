import { test } from "node:test";
import assert from "node:assert/strict";
import {
  occurrenceDates, expand, toRRule, resolveNow, nextAlarm, dueBetween, alarmLabel,
  zonedToEpoch, localParts, weekday, addDays, normalize, shortLabel,
} from "../index.js";

const TZ = "Europe/London";
const at = (date, time) => zonedToEpoch(date, time, TZ);

const course = normalize("courses", { id: "c1", name: "Algorithms", code: "CS201", color: "#B14242", location: "Room 4" });
const lecture = normalize("events", {
  id: "e1", course_id: "c1", kind: "lecture", start_date: "2026-09-01",
  start_time: "08:00", end_time: "10:00", repeat: { freq: "weekly", days: [2] }, exceptions: ["2026-10-27"],
});

test("dates: weekday and DST-safe zoned instants", () => {
  assert.equal(weekday("2026-09-29"), 2); // a Tuesday
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  // London leaves BST on 2026-10-25: 08:00 is UTC+1 before, UTC+0 after.
  assert.equal(new Date(at("2026-10-20", "08:00")).toISOString(), "2026-10-20T07:00:00.000Z");
  assert.equal(new Date(at("2026-10-27", "08:00")).toISOString(), "2026-10-27T08:00:00.000Z");
  assert.deepEqual(localParts(at("2026-10-27", "08:00"), TZ).time, "08:00");
  assert.equal(shortLabel("2026-09-29"), "Tue 29 Sep");
});

test("recurrence: weekly Tuesdays with an exception", () => {
  const d = occurrenceDates(lecture, "2026-10-01", "2026-11-05");
  assert.deepEqual(d, ["2026-10-06", "2026-10-13", "2026-10-20", "2026-11-03"]);
});

test("recurrence: fortnightly, until, daily, one-off", () => {
  const fort = { ...lecture, exceptions: [], repeat: { freq: "weekly", interval: 2, days: [2, 4], until: "2026-09-30" } };
  assert.deepEqual(occurrenceDates(fort, "2026-09-01", "2026-10-31"), ["2026-09-01", "2026-09-03", "2026-09-15", "2026-09-17", "2026-09-29"]);
  const daily = { ...lecture, exceptions: [], repeat: { freq: "daily", interval: 3 } };
  assert.deepEqual(occurrenceDates(daily, "2026-09-01", "2026-09-08"), ["2026-09-01", "2026-09-04", "2026-09-07"]);
  const once = { ...lecture, repeat: null, start_date: "2026-09-10" };
  assert.deepEqual(occurrenceDates(once, "2026-09-01", "2026-09-30"), ["2026-09-10"]);
  assert.deepEqual(occurrenceDates(once, "2026-09-11", "2026-09-30"), []);
});

test("recurrence: monthly and yearly, forever or until", () => {
  const rent = { ...lecture, exceptions: ["2026-12-31"], start_date: "2026-08-31", repeat: { freq: "monthly" } };
  // months without a 31st are skipped, like iCal; so is the exception
  assert.deepEqual(occurrenceDates(rent, "2026-08-01", "2027-03-31"), ["2026-08-31", "2026-10-31", "2027-01-31", "2027-03-31"]);
  const quarterly = { ...lecture, exceptions: [], start_date: "2026-01-15", repeat: { freq: "monthly", interval: 3, until: "2026-10-15" } };
  assert.deepEqual(occurrenceDates(quarterly, "2026-01-01", "2027-12-31"), ["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
  // a birthday entered with its real year, looked at decades later
  const birthday = { ...lecture, exceptions: [], start_date: "1995-03-14", repeat: { freq: "yearly" } };
  assert.deepEqual(occurrenceDates(birthday, "2026-01-01", "2028-12-31"), ["2026-03-14", "2027-03-14", "2028-03-14"]);
  assert.deepEqual(occurrenceDates(birthday, "2026-03-15", "2027-03-13"), []);
  assert.deepEqual(occurrenceDates(birthday, "1990-01-01", "1996-12-31"), ["1995-03-14", "1996-03-14"]);   // nothing before it starts
  const leap = { ...birthday, start_date: "2024-02-29" };
  assert.deepEqual(occurrenceDates(leap, "2024-01-01", "2032-12-31"), ["2024-02-29", "2028-02-29", "2032-02-29"]);
  const ended = { ...birthday, repeat: { freq: "yearly", until: "2026-12-31" } };
  assert.deepEqual(occurrenceDates(ended, "2026-01-01", "2030-12-31"), ["2026-03-14"]);
  // a rule from a newer version shows nothing instead of throwing
  assert.deepEqual(occurrenceDates({ ...lecture, repeat: { freq: "lunar" } }, "2026-01-01", "2026-12-31"), []);
  const occ = expand([birthday], new Map([["c1", course]]), "2026-03-14", "2026-03-14", TZ);
  assert.equal(occ.length, 1);
  const row = (freq) => normalize("events", { title: "Mum", kind: "event", start_date: "1970-05-02", start_time: "09:00", end_time: "10:00", repeat: { freq } });
  assert.equal(row("yearly").repeat.freq, "yearly");
  assert.equal(row("monthly").repeat.freq, "monthly");
  assert.throws(() => row("lunar"), /repeat.freq must be one of daily, weekly, monthly, yearly/);
});

test("recurrence: iCal RRULE", () => {
  assert.equal(toRRule({ ...lecture, repeat: { freq: "yearly" } }), "FREQ=YEARLY");
  assert.equal(toRRule({ ...lecture, repeat: { freq: "monthly", interval: 3, until: "2027-01-01" } }), "FREQ=MONTHLY;INTERVAL=3;UNTIL=20270101T235959");
  assert.equal(toRRule(lecture), "FREQ=WEEKLY;BYDAY=TU");
  assert.equal(toRRule({ ...lecture, repeat: { freq: "weekly", interval: 2, days: [1, 3], until: "2026-12-12" } }), "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261212T235959");
});

test("expand carries course details", () => {
  const occ = expand([lecture], new Map([["c1", course]]), "2026-09-29", "2026-09-29", TZ);
  assert.equal(occ.length, 1);
  assert.equal(occ[0].title, "Algorithms");
  assert.equal(occ[0].location, "Room 4");
  assert.equal(occ[0].end_ms - occ[0].start_ms, 2 * 3600000);
});

const notes = [
  normalize("notes", { id: "n1", course_id: "c1", event_id: "e1", session_date: "2026-09-29", title: "today", updated_at: 5 }),
  normalize("notes", { id: "n2", course_id: "c1", session_date: "2026-09-22", title: "last week", updated_at: 4 }),
  normalize("notes", { id: "n3", course_id: "c1", session_date: "2026-09-15", title: "older", updated_at: 3 }),
  normalize("notes", { id: "n4", course_id: "c1", title: "syllabus", pinned: 1, updated_at: 2 }),
  normalize("notes", { id: "n5", course_id: "other", session_date: "2026-09-29", title: "not mine", updated_at: 9 }),
];
const data = { courses: [course], events: [lecture], notes, alarms: [], timers: [] };

test("now: during the lecture its notes surface", () => {
  const r = resolveNow(data, at("2026-09-29", "08:30"), TZ);
  assert.equal(r.active.title, "Algorithms");
  assert.equal(r.active.state, "live");
  assert.equal(r.active.progress, 0.25);
  assert.deepEqual(r.notes.session.map((n) => n.id), ["n1"]);
  assert.deepEqual(r.notes.pinned.map((n) => n.id), ["n4"]);
  assert.deepEqual(r.notes.last.map((n) => n.id), ["n2"]);
  assert.equal(r.notes.last_date, "2026-09-22");
});

test("now: grace windows before and after", () => {
  assert.equal(resolveNow(data, at("2026-09-29", "07:52"), TZ).active?.state, "upcoming");
  assert.equal(resolveNow(data, at("2026-09-29", "07:45"), TZ).active, null);
  assert.equal(resolveNow(data, at("2026-09-29", "10:10"), TZ).active?.state, "ended");
  assert.equal(resolveNow(data, at("2026-09-29", "10:20"), TZ).active, null);
});

test("now: only today and the next 12 hours, else the day is off", () => {
  // Monday noon: Tuesday 08:00 is 20 h away, so nothing is shown.
  const far = resolveNow(data, at("2026-09-28", "12:00"), TZ);
  assert.equal(far.active, null);
  assert.equal(far.next, null);
  assert.equal(far.day_off, true);
  // Monday 21:00: Tuesday 08:00 is 11 h away, so it shows as next.
  const r = resolveNow(data, at("2026-09-28", "21:00"), TZ);
  assert.equal(r.next.date, "2026-09-29");
  assert.equal(r.next.starts_in_min, 11 * 60);
  assert.equal(r.day_off, false);
  assert.equal(r.focus, null); // next is tomorrow, so no notes forced on screen
});

test("now: a session marked off is not on", () => {
  const off = normalize("marks", { id: "c1:2026-09-29", course_id: "c1", date: "2026-09-29", status: "off" });
  const r = resolveNow({ ...data, marks: [off] }, at("2026-09-29", "09:00"), TZ);
  assert.equal(r.active, null);
  assert.equal(r.today[0].mark, "off");
});

test("expand: an event keeps its own zone's wall clock", () => {
  const cairo = { ...lecture, tz: "Africa/Cairo", exceptions: [] };
  // Shown in Cairo: 08:00. Shown in New York (7 h behind in September): 01:00 the same day.
  const inCairo = expand([cairo], new Map([["c1", course]]), "2026-09-29", "2026-09-29", "Africa/Cairo");
  assert.equal(inCairo[0].start_time, "08:00");
  const inNY = expand([cairo], new Map([["c1", course]]), "2026-09-29", "2026-09-29", "America/New_York");
  assert.equal(inNY[0].start_time, "01:00");
  assert.equal(inNY[0].end_time, "03:00");
  assert.equal(inNY[0].session_date, "2026-09-29");
  assert.equal(inNY[0].start_ms, inCairo[0].start_ms);
  // Tokyo is 6 h ahead: 14:00.
  assert.equal(expand([cairo], new Map([["c1", course]]), "2026-09-29", "2026-09-29", "Asia/Tokyo")[0].start_time, "14:00");
  // Without its own zone an event floats with the app's zone, as before.
  assert.equal(expand([lecture], new Map([["c1", course]]), "2026-09-29", "2026-09-29", "America/New_York")[0].start_time, "08:00");
});

test("alarms: fixed, weekly, one-off, lead-before-event", () => {
  const from = at("2026-09-28", "12:00"); // Monday
  const daily = normalize("alarms", { time: "07:00" });
  assert.equal(nextAlarm(daily, data, from, TZ), at("2026-09-29", "07:00"));
  const fri = normalize("alarms", { time: "09:00", days: [5] });
  assert.equal(nextAlarm(fri, data, from, TZ), at("2026-10-02", "09:00"));
  const once = normalize("alarms", { time: "09:00", date: "2026-09-27" });
  assert.equal(nextAlarm(once, data, from, TZ), null);
  const lead = normalize("alarms", { lead_event_id: "e1", lead_minutes: 20 });
  assert.equal(nextAlarm(lead, data, from, TZ), at("2026-09-29", "07:40"));
  const off = normalize("alarms", { time: "07:00", enabled: 0 });
  assert.equal(nextAlarm(off, data, from, TZ), null);
});

test("default lead alarm labels use course, event, and class fallbacks", () => {
  const from = at("2026-09-28", "12:00");
  const classData = { ...data, courses: [{ id: "c1", name: "Algorithms" }], events: [{ id: "e1", title: "Lecture", course_id: "c1" }] };
  assert.equal(alarmLabel({ id: "a1", label: "Alarm", lead_event_id: "e1", lead_minutes: 20 }, classData), "Algorithms in 20 min");
  assert.equal(alarmLabel({ id: "a2", label: "", lead_event_id: "e1" }, { ...classData, courses: [] }), "Lecture in 10 min");
  assert.equal(alarmLabel({ id: "a3", label: "Alarm", lead_course_id: "missing" }, { ...classData, courses: [], events: [] }), "Class in 10 min");
  assert.equal(alarmLabel({ id: "a4", label: "Exam", lead_course_id: "missing" }, classData), "Exam");
});

test("dueBetween includes running timers", () => {
  const now = at("2026-09-29", "09:00");
  const d = { ...data, timers: [normalize("timers", { id: "t1", label: "Focus", duration_s: 60, ends_at: now + 30000 })] };
  assert.deepEqual(dueBetween(d, now, now + 60000, TZ).map((x) => x.id), ["t1"]);
});

test("normalize validates", () => {
  assert.throws(() => normalize("events", { title: "x", start_date: "2026-9-1", start_time: "08:00", end_time: "09:00" }));
  assert.throws(() => normalize("courses", { name: " " }));
  const p = normalize("notes", { title: "x" }, { partial: true });
  assert.equal(p.body, undefined);
});
