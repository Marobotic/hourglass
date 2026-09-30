import { addDays, daysBetween, parseTime, weekday, weekStart, zonedToEpoch } from "./dates.js";

// Dates in [from, to] (inclusive) on which the event occurs.
export function occurrenceDates(event, from, to) {
  const start = event.start_date;
  const skip = new Set(event.exceptions ?? []);
  const rep = event.repeat;
  const out = [];
  if (!rep) {
    if (start >= from && start <= to && !skip.has(start)) out.push(start);
    return out;
  }
  const interval = Math.max(1, rep.interval ?? 1);
  const until = rep.until && rep.until < to ? rep.until : to;
  const first = start > from ? start : from;
  if (first > until) return out;
  if (rep.freq === "daily") {
    for (let d = first; d <= until; d = addDays(d, 1)) {
      if (daysBetween(start, d) % interval === 0 && !skip.has(d)) out.push(d);
    }
    return out;
  }
  if (rep.freq === "weekly") {
    const days = rep.days?.length ? rep.days : [weekday(start)];
    const anchor = weekStart(start);
    for (let d = first; d <= until; d = addDays(d, 1)) {
      if (!days.includes(weekday(d)) || skip.has(d)) continue;
      if ((daysBetween(anchor, weekStart(d)) / 7) % interval === 0) out.push(d);
    }
    return out;
  }
  throw new Error(`unknown repeat.freq: ${rep.freq}`);
}

// Concrete occurrences with instants, sorted by start. courses maps id -> course.
export function expand(events, courses, from, to, tz) {
  const out = [];
  for (const ev of events) {
    if (ev.deleted) continue;
    const course = ev.course_id ? courses.get(ev.course_id) : null;
    if (course?.deleted || course?.archived) continue;
    for (const date of occurrenceDates(ev, from, to)) {
      const startMin = parseTime(ev.start_time);
      let endMin = parseTime(ev.end_time);
      if (endMin <= startMin) endMin = startMin + 60;
      out.push({
        event_id: ev.id,
        course_id: ev.course_id ?? null,
        title: ev.title || course?.name || "Untitled",
        kind: ev.kind ?? "event",
        location: ev.location || course?.location || null,
        color: course?.color ?? "#4A8B8B",
        course_code: course?.code ?? null,
        date,
        start_time: ev.start_time,
        end_time: ev.end_time,
        start_ms: zonedToEpoch(date, ev.start_time, tz),
        end_ms: zonedToEpoch(date, ev.start_time, tz) + (endMin - startMin) * 60000,
      });
    }
  }
  return out.sort((a, b) => a.start_ms - b.start_ms || a.title.localeCompare(b.title));
}

// iCal RRULE for an event's repeat, or null.
export function toRRule(event) {
  const rep = event.repeat;
  if (!rep) return null;
  const parts = [`FREQ=${rep.freq.toUpperCase()}`];
  if ((rep.interval ?? 1) > 1) parts.push(`INTERVAL=${rep.interval}`);
  if (rep.freq === "weekly") {
    const codes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    const days = rep.days?.length ? rep.days : [weekday(event.start_date)];
    parts.push(`BYDAY=${days.map((d) => codes[d - 1]).join(",")}`);
  }
  if (rep.until) parts.push(`UNTIL=${rep.until.replaceAll("-", "")}T235959`);
  return parts.join(";");
}
