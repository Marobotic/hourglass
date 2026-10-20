import { addDays, localParts, weekday, zonedToEpoch } from "./dates.js";
import { expand } from "./recurrence.js";

const HORIZON_DAYS = 14;

// Next instant (ms) an alarm rings after fromMs, or null.
export function nextAlarm(alarm, data, fromMs, tz) {
  if (alarm.deleted || !alarm.enabled) return null;
  const today = localParts(fromMs, tz).date;

  if (alarm.lead_event_id || alarm.lead_course_id) {
    const evs = data.events.filter((e) => !e.deleted && (alarm.lead_event_id ? e.id === alarm.lead_event_id : e.course_id === alarm.lead_course_id));
    if (!evs.length) return null;
    const courses = new Map(data.courses.filter((c) => !c.deleted).map((c) => [c.id, c]));
    const lead = (alarm.lead_minutes ?? 10) * 60000;
    const occ = expand(evs, courses, today, addDays(today, HORIZON_DAYS), tz);
    return occ.map((o) => o.start_ms - lead).find((t) => t > fromMs) ?? null;
  }

  if (!alarm.time) return null;
  if (alarm.date) {
    const t = zonedToEpoch(alarm.date, alarm.time, tz);
    return t > fromMs ? t : null;
  }
  const days = alarm.days ?? [];
  for (let i = 0; i <= 7; i++) {
    const d = addDays(today, i);
    if (days.length && !days.includes(weekday(d))) continue;
    const t = zonedToEpoch(d, alarm.time, tz);
    if (t > fromMs) return t;
  }
  return null;
}

// Everything due to ring in (fromMs, toMs]: alarms and running timers.
// What a timer becomes when it rings: a saved one waits to be started again.
export const finishedTimer = (t) => (t.persistent ? { state: "idle", ends_at: null, remaining_s: null, start_at: null } : { state: "done" });

export function dueBetween(data, fromMs, toMs, tz) {
  const out = [];
  for (const a of data.alarms ?? []) {
    const t = nextAlarm(a, data, fromMs, tz);
    if (t !== null && t <= toMs) out.push({ kind: "alarm", id: a.id, at: t, label: a.label || "Alarm" });
  }
  for (const t of data.timers ?? []) {
    if (t.deleted || t.state !== "running" || !t.ends_at) continue;
    if (t.ends_at > fromMs && t.ends_at <= toMs) out.push({ kind: "timer", id: t.id, at: t.ends_at, label: t.label || "Timer" });
  }
  return out.sort((a, b) => a.at - b.at);
}

// A one-off alarm is spent once it has rung.
export const isSpent = (alarm, data, fromMs, tz) => !alarm.days?.length && !alarm.lead_event_id && !alarm.lead_course_id && nextAlarm(alarm, data, fromMs, tz) === null;

// --- reminders --------------------------------------------------------------
//
// A reminder shows once at its time, then waits (overdue) until it is done,
// like a to-do. A repeating one is pending from each time until done; its
// done_at says up to when everything is handled. A snooze moves when it shows.
//   { due_at: when it shows (next, or now-ish for an overdue snooze), next_at,
//     occurrence: the time it is about, overdue, done, repeats }
export function reminderState(r, nowMs, tz) {
  const days = r.days ?? [];
  const snooze = r.snooze_at ?? 0;
  if (!days.length) {
    const at = r.date && r.time ? zonedToEpoch(r.date, r.time, tz) : null;
    const done = r.done_at != null;
    const due = done || at === null ? null : Math.max(at, snooze);
    return { due_at: due, next_at: due, occurrence: at, overdue: !done && at !== null && at <= nowMs, done, repeats: false };
  }
  const today = localParts(nowMs, tz).date;
  let last = null;
  let upcoming = null;
  for (let i = -8; i <= 8; i++) {
    const d = addDays(today, i);
    if (!days.includes(weekday(d))) continue;
    const t = zonedToEpoch(d, r.time, tz);
    if (t <= nowMs) last = t;
    else if (upcoming === null) upcoming = t;
  }
  const pending = last !== null && last > (r.done_at ?? 0) ? last : null;
  const due = pending !== null ? Math.max(pending, snooze) : upcoming;
  return { due_at: due, next_at: due, occurrence: pending ?? upcoming, overdue: pending !== null, done: false, repeats: true };
}

// Reminders that show in (fromMs, toMs].
export function remindersDue(data, fromMs, toMs, tz) {
  const out = [];
  for (const r of data.reminders ?? []) {
    if (r.deleted) continue;
    const s = reminderState(r, toMs, tz);
    if (s.due_at !== null && s.due_at > fromMs && s.due_at <= toMs) out.push({ kind: "reminder", id: r.id, at: s.due_at, label: r.label || "Reminder" });
  }
  return out.sort((a, b) => a.at - b.at);
}
