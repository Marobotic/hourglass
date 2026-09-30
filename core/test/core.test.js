import { test } from "node:test";
import assert from "node:assert/strict";
import {
  occurrenceDates, expand, toRRule, resolveNow, nextAlarm, dueBetween,
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

test("recurrence: iCal RRULE", () => {
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

test("now: nothing on shows next with countdown", () => {
  const r = resolveNow(data, at("2026-09-28", "12:00"), TZ);
  assert.equal(r.active, null);
  assert.equal(r.next.date, "2026-09-29");
  assert.equal(r.next.starts_in_min, 20 * 60);
  assert.equal(r.focus, null); // next is tomorrow, so no notes forced on screen
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
