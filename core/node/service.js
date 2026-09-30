// Domain operations behind REST, MCP and the Linux app. Arguments are the
// friendly shapes an AI would send: course names instead of ids, weekday
// names, "HH:MM" times.
import { addDays, isDate, localParts, parseTime, shortLabel, systemZone, weekStart } from "../dates.js";
import { expand } from "../recurrence.js";
import { resolveNow, sessionNotes } from "../now.js";
import { nextAlarm } from "../alarms.js";
import { PALETTE, parseWeekday } from "../model.js";

export class Service {
  constructor(store, { clock = () => Date.now() } = {}) {
    this.store = store;
    this.clock = clock;
  }

  get tz() {
    return this.store.meta("tz") || systemZone();
  }

  today() {
    return localParts(this.clock(), this.tz).date;
  }

  data() {
    return this.store.snapshot();
  }

  // --- lookups ---------------------------------------------------------------

  course(ref, { required = true } = {}) {
    if (ref == null || ref === "") {
      if (required) throw new Error("course is required");
      return null;
    }
    const all = this.store.all("courses");
    const key = String(ref).trim().toLowerCase();
    const hit =
      all.find((c) => c.id === ref) ??
      all.find((c) => c.name.toLowerCase() === key) ??
      all.find((c) => c.code?.toLowerCase() === key);
    if (hit) return hit;
    const partial = all.filter((c) => c.name.toLowerCase().includes(key) || c.code?.toLowerCase().includes(key));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) throw new Error(`"${ref}" matches several courses: ${partial.map((c) => c.name).join(", ")}`);
    throw new Error(`no course called "${ref}". Courses: ${all.map((c) => c.name).join(", ") || "none yet"}`);
  }

  row(table, id) {
    const r = this.store.get(table, id);
    if (!r || r.deleted) throw new Error(`no ${table.slice(0, -1)} with id ${id}`);
    return r;
  }

  // --- now & schedule --------------------------------------------------------

  whatsNow() {
    const r = resolveNow(this.data(), this.clock(), this.tz);
    const alarms = this.listAlarms().filter((a) => a.next_at).slice(0, 3);
    return { ...r, alarms };
  }

  schedule({ from, to } = {}) {
    const start = from || weekStart(this.today());
    const end = to || addDays(start, 6);
    if (!isDate(start) || !isDate(end)) throw new Error("from and to must be YYYY-MM-DD");
    const courses = new Map(this.store.all("courses").map((c) => [c.id, c]));
    return { from: start, to: end, tz: this.tz, occurrences: expand(this.store.all("events"), courses, start, end, this.tz) };
  }

  // --- courses ---------------------------------------------------------------

  listCourses() {
    const today = this.today();
    const sched = this.schedule({ from: today, to: addDays(today, 13) }).occurrences;
    const notes = this.store.all("notes");
    return this.store
      .all("courses")
      .filter((c) => !c.archived)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        ...c,
        note_count: notes.filter((n) => n.course_id === c.id).length,
        next: sched.find((o) => o.course_id === c.id && o.end_ms > this.clock()) ?? null,
        events: this.store.all("events").filter((e) => e.course_id === c.id),
      }));
  }

  addCourse({ name, code, color, location, teacher, schedule = [], term_start, term_end }) {
    const used = new Set(this.store.all("courses").map((c) => c.color));
    const course = this.store.upsert("courses", {
      name,
      code,
      location,
      teacher,
      color: color || PALETTE.find((p) => !used.has(p)) || PALETTE[used.size % PALETTE.length],
    });
    const events = schedule.map((s) =>
      this.addEvent({
        course: course.id,
        kind: s.kind || "lecture",
        start: s.start,
        end: s.end,
        location: s.location,
        date: this.firstOnOrAfter(term_start || this.today(), parseWeekday(s.day)),
        repeat: { freq: "weekly", days: [parseWeekday(s.day)], until: term_end },
      }),
    );
    return { course, events };
  }

  updateCourse({ course, ...patch }) {
    const c = this.course(course);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    return this.store.upsert("courses", { ...clean, id: c.id });
  }

  removeCourse({ course }) {
    const c = this.course(course);
    for (const e of this.store.all("events").filter((e) => e.course_id === c.id)) this.store.remove("events", e.id);
    return this.store.remove("courses", c.id);
  }

  firstOnOrAfter(date, isoDay) {
    let d = date;
    for (let i = 0; i < 7; i++, d = addDays(d, 1)) if (localWeekday(d) === isoDay) return d;
    return date;
  }

  // --- events ----------------------------------------------------------------

  addEvent({ course, title, kind, date, start, end, location, repeat }) {
    const c = this.course(course, { required: false });
    if (!start) throw new Error("start (HH:MM) is required");
    const endTime = end || addMinutes(start, 60);
    return this.store.upsert("events", {
      course_id: c?.id ?? null,
      title: title || "",
      kind: kind || (c ? "lecture" : "event"),
      location,
      start_date: date || this.today(),
      start_time: start,
      end_time: endTime,
      repeat: normalizeRepeat(repeat, date || this.today()),
    });
  }

  updateEvent({ event_id, course, title, kind, date, start, end, location, repeat }) {
    const ev = this.row("events", event_id);
    const patch = { id: ev.id };
    if (course !== undefined) patch.course_id = this.course(course, { required: false })?.id ?? null;
    if (title !== undefined) patch.title = title;
    if (kind !== undefined) patch.kind = kind;
    if (date !== undefined) patch.start_date = date;
    if (start !== undefined) patch.start_time = start;
    if (end !== undefined) patch.end_time = end;
    if (location !== undefined) patch.location = location;
    if (repeat !== undefined) patch.repeat = normalizeRepeat(repeat, date || ev.start_date);
    return this.store.upsert("events", patch);
  }

  // scope "occurrence" skips one date of a recurring event; "series" deletes it.
  removeEvent({ event_id, scope = "series", date }) {
    const ev = this.row("events", event_id);
    if (scope === "occurrence" && ev.repeat) {
      if (!isDate(date)) throw new Error("date (YYYY-MM-DD) is required to remove one occurrence");
      return this.store.upsert("events", { id: ev.id, exceptions: [...new Set([...(ev.exceptions ?? []), date])] });
    }
    return this.store.remove("events", ev.id);
  }

  // --- notes -----------------------------------------------------------------

  getNotes({ course, date, limit = 20 } = {}) {
    const c = this.course(course, { required: false });
    let notes = this.store.all("notes");
    if (c) notes = notes.filter((n) => n.course_id === c.id);
    if (date) notes = notes.filter((n) => n.session_date === date);
    return notes.sort((a, b) => b.updated_at - a.updated_at).slice(0, limit).map((n) => this.describeNote(n));
  }

  sessionNotes(occ) {
    return sessionNotes(this.store.all("notes"), occ);
  }

  describeNote(n) {
    const c = n.course_id ? this.store.get("courses", n.course_id) : null;
    return { ...n, course_name: c?.name ?? null, session_label: n.session_date ? shortLabel(n.session_date) : null };
  }

  // With a course and no date, the note goes to today's session if the
  // course meets today, otherwise it is a course note without a session.
  addNote({ course, date, event_id, title, body = "", pinned = false }) {
    const c = this.course(course, { required: false });
    let session = date ?? null;
    let eventId = event_id ?? null;
    if (c && !date) {
      const today = this.today();
      const occ = this.schedule({ from: today, to: today }).occurrences.find((o) => o.course_id === c.id);
      if (occ) {
        session = today;
        eventId ??= occ.event_id;
      }
    }
    return this.store.upsert("notes", {
      course_id: c?.id ?? null,
      event_id: eventId,
      session_date: session,
      title: title || (session ? shortLabel(session) : "Untitled"),
      body,
      pinned,
    });
  }

  updateNote({ note_id, title, body, pinned, course, date }) {
    const n = this.row("notes", note_id);
    const patch = { id: n.id };
    if (title !== undefined) patch.title = title;
    if (body !== undefined) patch.body = body;
    if (pinned !== undefined) patch.pinned = pinned;
    if (course !== undefined) patch.course_id = this.course(course, { required: false })?.id ?? null;
    if (date !== undefined) patch.session_date = date;
    return this.store.upsert("notes", patch);
  }

  appendNote({ note_id, text }) {
    const n = this.row("notes", note_id);
    const body = n.body ? `${n.body.replace(/\s+$/, "")}\n\n${text}` : text;
    return this.store.upsert("notes", { id: n.id, body });
  }

  deleteNote({ note_id }) {
    return this.store.remove("notes", this.row("notes", note_id).id);
  }

  searchNotes({ query, limit = 20 }) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    return this.store
      .all("notes")
      .map((n) => {
        const hay = `${n.title}\n${n.body}`.toLowerCase();
        const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
        return { n, score };
      })
      .filter((x) => x.score === words.length)
      .sort((a, b) => b.n.updated_at - a.n.updated_at)
      .slice(0, limit)
      .map(({ n }) => {
        const i = n.body.toLowerCase().indexOf(words[0]);
        const snippet = i >= 0 ? n.body.slice(Math.max(0, i - 60), i + 120) : n.body.slice(0, 160);
        return { ...this.describeNote(n), body: undefined, snippet };
      });
  }

  // --- alarms ----------------------------------------------------------------

  listAlarms() {
    const data = this.data();
    return data.alarms
      .map((a) => ({ ...a, next_at: nextAlarm(a, data, this.clock(), this.tz) }))
      .sort((a, b) => (a.next_at ?? Infinity) - (b.next_at ?? Infinity));
  }

  // before: an event id, or a course name for every session of that course.
  setAlarm({ label, time, days, date, before, minutes_before, enabled = true, alarm_id }) {
    let leadEvent = null;
    let leadCourse = null;
    if (before) {
      const ev = this.store.get("events", before);
      if (ev && !ev.deleted) leadEvent = ev;
      else {
        leadCourse = this.course(before);
        label ||= `${leadCourse.name} in ${minutes_before ?? 10} min`;
      }
    }
    const lead = leadEvent || leadCourse;
    return this.store.upsert("alarms", {
      id: alarm_id,
      label: label || "Alarm",
      time: lead ? null : time,
      days: lead ? [] : (days ?? []).map(parseWeekday),
      date: lead ? null : date ?? null,
      lead_event_id: leadEvent?.id ?? null,
      lead_course_id: leadCourse?.id ?? null,
      lead_minutes: lead ? minutes_before ?? 10 : null,
      enabled,
    });
  }

  removeAlarm({ alarm_id }) {
    return this.store.remove("alarms", this.row("alarms", alarm_id).id);
  }

  // --- timers ----------------------------------------------------------------

  listTimers() {
    const now = this.clock();
    return this.store
      .all("timers")
      .filter((t) => t.state !== "done")
      .map((t) => ({ ...t, remaining_s: t.state === "running" ? Math.max(0, Math.ceil((t.ends_at - now) / 1000)) : t.remaining_s }));
  }

  startTimer({ minutes, seconds, label }) {
    const duration = Math.round((Number(minutes) || 0) * 60 + (Number(seconds) || 0));
    if (duration <= 0) throw new Error("give minutes or seconds");
    return this.store.upsert("timers", {
      label: label || `${fmtDuration(duration)} timer`,
      duration_s: duration,
      state: "running",
      ends_at: this.clock() + duration * 1000,
      remaining_s: null,
    });
  }

  // action: pause | resume | stop | done
  updateTimer({ timer_id, action }) {
    const t = this.row("timers", timer_id);
    const now = this.clock();
    if (action === "pause" && t.state === "running")
      return this.store.upsert("timers", { id: t.id, state: "paused", remaining_s: Math.max(0, Math.ceil((t.ends_at - now) / 1000)), ends_at: null });
    if (action === "resume" && t.state === "paused")
      return this.store.upsert("timers", { id: t.id, state: "running", ends_at: now + t.remaining_s * 1000, remaining_s: null });
    if (action === "done") return this.store.upsert("timers", { id: t.id, state: "done" });
    if (action === "stop") return this.store.remove("timers", t.id);
    throw new Error(`cannot ${action} a ${t.state} timer`);
  }

  // --- settings --------------------------------------------------------------

  settings() {
    return { tz: this.tz };
  }

  setSettings({ tz }) {
    if (tz) {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      this.store.setMeta("tz", tz);
    }
    return this.settings();
  }
}

function localWeekday(date) {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

function addMinutes(time, m) {
  const t = parseTime(time) + m;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function normalizeRepeat(repeat, startDate) {
  if (!repeat || repeat === "none") return null;
  if (typeof repeat === "string") repeat = { freq: repeat };
  const out = { freq: repeat.freq || "weekly" };
  if (repeat.interval > 1) out.interval = Number(repeat.interval);
  if (repeat.days?.length) out.days = repeat.days.map(parseWeekday);
  else if (out.freq === "weekly") out.days = [localWeekday(startDate)];
  if (repeat.until) out.until = repeat.until;
  return out;
}

export function fmtDuration(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  if (m) return sec ? `${m} min ${sec} s` : `${m} min`;
  return `${sec} s`;
}
