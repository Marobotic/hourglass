import { addDays, localParts, shortLabel } from "./dates.js";
import { expand } from "./recurrence.js";
import { markId } from "./model.js";

export const EARLY_MS = 10 * 60000;
export const LATE_MS = 15 * 60000;
// "Now" is about today: what is on, and what comes in the next 12 hours.
// Anything later (tomorrow's lecture when today is free) is not shown.
export const AHEAD_MS = 12 * 3600000;
const LOOKAHEAD_DAYS = 1;

// Attendance marks by session: id -> status.
export function markMap(marks) {
  return new Map(live(marks ?? []).map((m) => [m.id, m.status]));
}

export const markOf = (marks, o) => marks.get(markId(o.course_id, o.event_id, o.session_date ?? o.date)) ?? null;

const live = (rows) => rows.filter((r) => !r.deleted);
const byUpdated = (a, b) => b.updated_at - a.updated_at;

// What is on right now, what is next, and which notes belong in front of the user.
// data: { courses, events, notes, alarms, timers } arrays.
export function resolveNow(data, nowMs, tz) {
  const here = localParts(nowMs, tz);
  const courses = new Map(live(data.courses).map((c) => [c.id, c]));
  const marks = markMap(data.marks);
  const all = expand(live(data.events), courses, addDays(here.date, -1), addDays(here.date, LOOKAHEAD_DAYS), tz).map((o) => ({ ...o, mark: markOf(marks, o) }));
  // A session marked "off" is not happening.
  const occ = all.filter((o) => o.mark !== "off");

  const today = all.filter((o) => o.date === here.date);
  const active =
    occ.find((o) => nowMs >= o.start_ms && nowMs < o.end_ms) ??
    occ.find((o) => nowMs >= o.start_ms - EARLY_MS && nowMs < o.end_ms + LATE_MS) ??
    null;
  const next = occ.find((o) => o.start_ms > nowMs && o !== active && (o.date === here.date || o.start_ms - nowMs <= AHEAD_MS)) ?? null;

  const focus = active ?? (next && next.date === here.date ? next : null);
  const notes = focus ? sessionNotes(data.notes, focus) : { session: [], pinned: [], last: [], last_date: null };

  return {
    now: { ms: nowMs, date: here.date, time: here.time, weekday: here.weekday, label: shortLabel(here.date), tz },
    active: active && decorate(active, nowMs),
    next: next && decorate(next, nowMs),
    focus: focus && decorate(focus, nowMs),
    today: today.map((o) => decorate(o, nowMs)),
    notes,
    // Nothing on, nothing left today and nothing in the next 12 hours.
    day_off: !active && !next,
    timers: live(data.timers ?? []).filter((t) => t.state !== "done"),
  };
}

function decorate(o, nowMs) {
  const state = nowMs < o.start_ms ? "upcoming" : nowMs < o.end_ms ? "live" : "ended";
  const progress = state === "live" ? (nowMs - o.start_ms) / (o.end_ms - o.start_ms) : state === "ended" ? 1 : 0;
  return {
    ...o,
    state,
    progress: Math.round(progress * 1000) / 1000,
    starts_in_min: Math.max(0, Math.ceil((o.start_ms - nowMs) / 60000)),
    ends_in_min: Math.max(0, Math.ceil((o.end_ms - nowMs) / 60000)),
    session_label: shortLabel(o.date),
  };
}

// Notes for one session: written for it, pinned in its course, and the most
// recent earlier session ("last time").
export function sessionNotes(notes, occ) {
  const mine = live(notes).filter((n) => n.course_id && n.course_id === occ.course_id);
  const date = occ.session_date ?? occ.date;
  const session = mine
    .filter((n) => n.session_date === date && (!n.event_id || n.event_id === occ.event_id))
    .sort(byUpdated);
  const pinned = mine.filter((n) => n.pinned && n.session_date !== date).sort(byUpdated);
  const earlier = mine.filter((n) => n.session_date && n.session_date < date && !n.pinned);
  const last_date = earlier.reduce((m, n) => (n.session_date > m ? n.session_date : m), "") || null;
  const last = last_date ? earlier.filter((n) => n.session_date === last_date).sort(byUpdated) : [];
  return { session, pinned, last, last_date };
}

export function defaultNoteTitle(date) {
  return shortLabel(date);
}
