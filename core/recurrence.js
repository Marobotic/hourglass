import { addDays, daysBetween, localParts, pad, parseTime, weekday, weekStart, zonedToEpoch } from "./dates.js";

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// Monthly and yearly: the first date's day of the month, every `step` months. A month without
// that day (the 31st, or 29 Feb outside leap years) is skipped, as iCal and other calendars do.
// Starts near `first` instead of walking from the start date: a birthday entered with its real
// year (1995-03-14) costs the same as one entered this year.
function sameDayDates(start, first, until, step, skip) {
  const [y, m, d] = start.split("-").map(Number);
  const [fy, fm] = first.split("-").map(Number);
  const out = [];
  for (let n = Math.max(0, Math.floor(((fy - y) * 12 + fm - m) / step) - 1); ; n++) {
    const months = m - 1 + n * step;
    const yy = y + Math.floor(months / 12);
    const mm = (months % 12) + 1;
    const date = `${String(yy).padStart(4, "0")}-${pad(mm)}-${pad(d)}`;
    if (date > until) break;
    if (d <= daysInMonth(yy, mm) && date >= first && !skip.has(date)) out.push(date);
  }
  return out;
}

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
  if (rep.freq === "monthly") return sameDayDates(start, first, until, interval, skip);
  if (rep.freq === "yearly") return sameDayDates(start, first, until, 12 * interval, skip);
  // A rule from a newer version: show nothing for it rather than break the whole schedule.
  return out;
}

// Concrete occurrences with instants, sorted by start. courses maps id -> course.
// tz is the zone to show them in. An event with its own tz keeps its times in
// that zone: 08:00 Cairo is 01:00 when the app shows New York. date,
// start_time and end_time are in tz; session_date is the event's own date,
// which notes and marks are keyed by.
export function expand(events, courses, from, to, tz) {
  const out = [];
  for (const ev of events) {
    if (ev.deleted) continue;
    const course = ev.course_id ? courses.get(ev.course_id) : null;
    if (course?.deleted || course?.archived) continue;
    const ez = ev.tz || tz;
    const shifted = ez !== tz;
    const startMin = parseTime(ev.start_time);
    let endMin = parseTime(ev.end_time);
    if (endMin <= startMin) endMin = startMin + 60;
    // Another zone can move a session across midnight: look a day either side.
    for (const session of occurrenceDates(ev, shifted ? addDays(from, -1) : from, shifted ? addDays(to, 1) : to)) {
      const start_ms = zonedToEpoch(session, ev.start_time, ez);
      const end_ms = start_ms + (endMin - startMin) * 60000;
      const here = shifted ? localParts(start_ms, tz) : null;
      const date = here ? here.date : session;
      if (date < from || date > to) continue;
      out.push({
        event_id: ev.id,
        course_id: ev.course_id ?? null,
        title: ev.title || course?.name || "Untitled",
        kind: ev.kind ?? "event",
        location: ev.location || course?.location || null,
        color: course?.color ?? "#4A8B8B",
        course_code: course?.code ?? null,
        teacher: course?.teacher ?? null,
        date,
        session_date: session,
        start_time: here ? here.time : ev.start_time,
        end_time: here ? localParts(end_ms, tz).time : ev.end_time,
        event_tz: ez,
        start_ms,
        end_ms,
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
