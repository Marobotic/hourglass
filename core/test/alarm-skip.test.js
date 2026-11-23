// One ring skipped or dismissed for the whole account (the synced
// "ring_stop:<alarm id>" pref), as every app's schedule reads it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alarmRingOn, dueBetween, isSpent, nextAlarm, nextAlarmTime, normalize, ringStopKey, ringStopOf, ringStopped, zonedToEpoch } from "../index.js";

const TZ = "Africa/Cairo";
const at = (d, t) => zonedToEpoch(d, t, TZ);
const lecture = normalize("events", { id: "e1", course_id: "c1", kind: "lecture", start_date: "2026-11-02", start_time: "08:30", end_time: "10:30", repeat: { freq: "weekly", days: [1] } });
const course = normalize("courses", { id: "c1", name: "Computer-Aided Graphic Design (1)" });
const leadAlarm = normalize("alarms", { id: "a1", label: "Alarm", lead_event_id: "e1", lead_minutes: 45, enabled: 1 });
const daily = normalize("alarms", { id: "a2", label: "Wake up", time: "07:00", days: [1, 2, 3, 4, 5, 6, 7], enabled: 1 });
const stop = (id, value) => normalize("prefs", { id: ringStopKey(id), value: JSON.stringify(value) });
const data = (prefs = []) => ({ events: [lecture], courses: [course], alarms: [leadAlarm, daily], timers: [], prefs });

test("a skipped ring is passed over; the alarm's own schedule is not", () => {
  const ring = at("2026-11-23", "07:45");
  const d = data([stop("a1", { at: ring, action: "dismissed", device: "Assistant", skipped: true })]);
  const from = at("2026-11-23", "07:36");
  assert.equal(nextAlarmTime(leadAlarm, d, from, TZ), ring);
  assert.equal(nextAlarm(leadAlarm, d, from, TZ), at("2026-11-30", "07:45"));
  assert.deepEqual(dueBetween(d, from, at("2026-11-23", "08:00"), TZ), []);
  assert.equal(ringStopOf(d, "a1").skipped, true);
  // Without the skip it rings as usual.
  assert.equal(nextAlarm(leadAlarm, data(), from, TZ), ring);
});

test("a dismissal on another device keeps that ring off every device's schedule", () => {
  const ring = at("2026-11-24", "07:00");
  const d = data([stop("a2", { at: ring, action: "dismissed", device: "iPhone", ts: ring + 3000 })]);
  // A device that checks from before the ring (its last check) does not ring it again.
  assert.deepEqual(dueBetween(d, ring - 60_000, ring + 60_000, TZ).map((x) => x.id), []);
  assert.equal(nextAlarm(daily, d, ring - 60_000, TZ), at("2026-11-25", "07:00"));
});

test("alarmRingOn: the ring still to come on a given day", () => {
  assert.equal(alarmRingOn(leadAlarm, data(), "2026-11-23", at("2026-11-23", "07:36"), TZ), at("2026-11-23", "07:45"));
  assert.equal(alarmRingOn(leadAlarm, data(), "2026-11-23", at("2026-11-23", "07:50"), TZ), null);
  assert.equal(alarmRingOn(leadAlarm, data(), "2026-11-24", at("2026-11-23", "07:50"), TZ), null); // no lecture Tuesday
  assert.equal(alarmRingOn(leadAlarm, data(), "2026-11-30", at("2026-11-23", "07:50"), TZ), at("2026-11-30", "07:45"));
});

test("ringStopped: why a ring must not ring or come back as a snooze", () => {
  const ring = at("2026-11-23", "07:45");
  assert.equal(ringStopped(leadAlarm, null, ring), null);
  assert.equal(ringStopped({ ...leadAlarm, enabled: 0 }, null, ring).reason, "off");
  assert.equal(ringStopped({ ...leadAlarm, deleted: 1 }, null, ring).reason, "deleted");
  assert.equal(ringStopped(leadAlarm, { at: ring, action: "dismissed", device: "iPhone" }, ring).device, "iPhone");
  assert.equal(ringStopped(leadAlarm, { at: ring - 1, action: "dismissed", device: "iPhone" }, ring), null, "another ring's stop");
  // A one-off alarm turns itself off as it rings: its snooze must still work.
  const once = normalize("alarms", { id: "a3", time: "07:45", date: "2026-11-23", enabled: 0 });
  assert.equal(ringStopped(once, null, ring), null);
  assert.equal(isSpent({ ...once, enabled: 1 }, data(), ring + 1000, TZ), true);
});
