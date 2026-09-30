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
