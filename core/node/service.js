// Domain operations behind REST, MCP and the Linux app. Arguments are the
// friendly shapes an AI would send: course names instead of ids, weekday
// names, "HH:MM" times.
import { MONTHS, WEEKDAYS, addDays, isDate, localParts, parseTime, shortLabel, systemZone, weekStart } from "../dates.js";
import { expand } from "../recurrence.js";
import { markMap, markOf, resolveNow, sessionNotes } from "../now.js";
import { finishedTimer, nextAlarm } from "../alarms.js";
import { BUILTIN_RINGTONES, MARKS, PALETTE, markId, parseWeekday } from "../model.js";
import { numberedTitle } from "./store.js";
import { plainText } from "../noteformat.js";

export class Service {
  constructor(store, { clock = () => Date.now() } = {}) {
    this.store = store;
    this.clock = clock;
  }

  // The home clock (synced) sets the app's time zone everywhere; before one
  // exists, the device setting or the system zone.
  get tz() {
    return this.store.all("clocks").find((c) => c.home)?.zone || this.store.meta("tz") || systemZone();
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
    const marks = markMap(this.store.all("marks"));
    const occurrences = expand(this.store.all("events"), courses, start, end, this.tz).map((o) => ({ ...o, mark: markOf(marks, o) }));
    return { from: start, to: end, tz: this.tz, occurrences };
  }

  // Events by name, at any date: "when is Ashwasky's birthday" must not depend on which week is
  // shown. Every word of the query must appear in the title, course or room, ignoring case,
  // accents and punctuation ("ashwasky" finds "Ashwasky's birthday", "birthdays" finds
  // "birthday"). No query lists every event. Sorted by the next date; past one-offs last.
  findEvents({ query = "", limit = 50, personal = false } = {}) {
    const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const words = norm(query).split(" ").filter(Boolean).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w));
    const courses = new Map(this.store.all("courses").map((c) => [c.id, c]));
    const today = this.today();
    const out = [];
    for (const ev of this.store.all("events")) {
      if (ev.deleted || (personal && ev.course_id)) continue;
      const course = ev.course_id ? courses.get(ev.course_id) : null;
      if (course?.deleted) continue;
      const hay = norm(`${ev.title} ${course?.name ?? ""} ${course?.code ?? ""} ${ev.location ?? ""}`);
      if (!words.every((w) => hay.includes(w))) continue;
      const next = this.nextOccurrence(ev, courses, today);
      out.push({
        event_id: ev.id,
        title: ev.title || course?.name || "Untitled",
        course: course?.name ?? null,
        kind: ev.kind,
        repeats: describeRepeat(ev),
        first_date: ev.start_date,
        start_time: ev.start_time,
        end_time: ev.end_time,
        tz: ev.tz ?? this.tz,
        location: ev.location ?? null,
        next: next ? { date: next.date, start_time: next.start_time, end_time: next.end_time } : null,
      });
    }
    out.sort((a, b) => (a.next?.date ?? "9999").localeCompare(b.next?.date ?? "9999") || a.title.localeCompare(b.title));
    return { query, today, count: out.length, events: out.slice(0, limit) };
  }

  // The first occurrence from `from` on, looking far enough ahead for the rule (a yearly event
  // on 29 Feb can be four years away).
  nextOccurrence(ev, courses, from) {
    const rep = ev.repeat;
    const n = Math.max(1, rep?.interval ?? 1);
    const days = !rep ? Math.max(0, Math.round((Date.parse(ev.start_date) - Date.parse(from)) / 864e5))
      : rep.freq === "yearly" ? 366 * 8 * n : rep.freq === "monthly" ? 31 * (n + 12) : 7 * n + 400;
    return expand([ev], courses, from, addDays(from, days), this.tz)[0] ?? null;
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
        next: sched.find((o) => o.course_id === c.id && o.end_ms > this.clock() && o.mark !== "off") ?? null,
        events: this.store.all("events").filter((e) => e.course_id === c.id),
        attendance: this.attendanceCounts(c.id),
      }));
  }

  addCourse({ name, code, color, location, teacher, schedule = [], term_start, term_end, tz }) {
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
        tz,
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

  addEvent({ course, title, kind, date, start, end, location, repeat, tz }) {
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
      // Locked to the zone it was entered in.
      tz: eventZone(tz || this.tz),
      repeat: normalizeRepeat(repeat, date || this.today()),
    });
  }

  updateEvent({ event_id, course, title, kind, date, start, end, location, repeat, tz }) {
    const ev = this.row("events", event_id);
    const patch = { id: ev.id };
    if (course !== undefined) patch.course_id = this.course(course, { required: false })?.id ?? null;
    if (title !== undefined) patch.title = title;
    if (kind !== undefined) patch.kind = kind;
    if (date !== undefined) patch.start_date = date;
    if (start !== undefined) patch.start_time = start;
    if (end !== undefined) patch.end_time = end;
    if (location !== undefined) patch.location = location;
    if (tz !== undefined) patch.tz = tz ? eventZone(tz) : null;
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

  // --- drive -------------------------------------------------------------------

  // One folder's contents (null = the top), with the path down to it. Every
  // course has its own folder (course_id) holding the files put there; the
  // top lists the courses and the files and folders that are in none.
  listDrive({ folder_id = null, course_id = null } = {}) {
    const folders = this.store.all("folders");
    const courses = this.store.all("courses").filter((c) => !c.archived);
    const known = new Set(courses.map((c) => c.id));
    const files = this.store.all("files").map((f) => (f.course_id && !known.has(f.course_id) ? { ...f, course_id: null } : f));
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (course_id) {
      const c = this.course(course_id);
      return { course_id: c.id, folder_id: null, path: [{ id: c.id, name: c.name, course: true }], folders: [], courses: [],
        files: files.filter((f) => f.course_id === c.id).sort(byName) };
    }
    const path = [];
    for (let f = folder_id ? this.row("folders", folder_id) : null; f; f = f.parent_id ? folders.find((x) => x.id === f.parent_id) : null) path.unshift({ id: f.id, name: f.name });
    const top = !folder_id;
    return {
      folder_id: folder_id ?? null,
      course_id: null,
      courses: top ? courses.sort(byName).map((c) => ({ id: c.id, name: c.name, color: c.color, items: files.filter((f) => f.course_id === c.id).length })) : [],
      path,
      folders: folders.filter((f) => (f.parent_id ?? null) === (folder_id ?? null)).sort(byName)
        .map((f) => ({ ...f, items: folders.filter((x) => x.parent_id === f.id).length + files.filter((x) => x.folder_id === f.id).length })),
      files: files.filter((f) => !f.course_id && (f.folder_id ?? null) === (folder_id ?? null)).sort(byName),
    };
  }

  // Put a file in a course's folder (or take it out with course: null).
  moveFile({ file_id, course, folder_id }) {
    const f = this.row("files", file_id);
    const patch = { id: f.id };
    if (course !== undefined) {
      patch.course_id = course ? this.course(course).id : null;
      if (patch.course_id) patch.folder_id = null;
    }
    if (folder_id !== undefined) {
      if (folder_id) this.row("folders", folder_id);
      patch.folder_id = folder_id || null;
      if (folder_id) patch.course_id = null;
    }
    return this.store.upsert("files", patch);
  }

  // Put a folder inside another (parent_id null = the top). A folder never
  // goes into itself or into one of its own subfolders.
  moveFolder({ folder_id, parent_id = null }) {
    const f = this.row("folders", folder_id);
    const target = parent_id || null;
    if (target) {
      const all = this.store.all("folders");
      for (let p = this.row("folders", target); p; p = p.parent_id ? all.find((x) => x.id === p.parent_id) : null) {
        if (p.id === f.id) throw new Error(`"${f.name}" cannot go inside itself or one of its own folders`);
      }
    }
    return this.store.upsert("folders", { id: f.id, parent_id: target });
  }

  addFolder({ name, parent_id = null }) {
    if (parent_id) this.row("folders", parent_id);
    return this.store.upsert("folders", { name: String(name ?? "").trim(), parent_id });
  }

  // A folder goes with everything in it.
  removeFolder({ folder_id }) {
    const f = this.row("folders", folder_id);
    for (const sub of this.store.all("folders").filter((x) => x.parent_id === f.id)) this.removeFolder({ folder_id: sub.id });
    for (const file of this.store.all("files").filter((x) => x.folder_id === f.id)) this.store.remove("files", file.id);
    return this.store.remove("folders", f.id);
  }

  // --- attendance --------------------------------------------------------------

  // Mark one day of a course attended, absent or off; status "none" clears it.
  // date defaults to today; course or event_id picks the session.
  markSession({ course, event_id, date, status }) {
    const day = date || this.today();
    if (!isDate(day)) throw new Error("date must be YYYY-MM-DD");
    const ev = event_id ? this.row("events", event_id) : null;
    const c = ev ? (ev.course_id ? this.store.get("courses", ev.course_id) : null) : this.course(course);
    const id = markId(c?.id, ev?.id, day);
    if (status === "none" || status === null) return this.store.remove("marks", id) ?? { ok: true, cleared: id };
    if (!MARKS.includes(status)) throw new Error(`status must be one of ${MARKS.join(", ")} or none`);
    return this.store.upsert("marks", { id, course_id: c?.id ?? null, event_id: c ? null : ev.id, date: day, status });
  }

  attendanceCounts(courseId) {
    const out = { attended: 0, absent: 0, off: 0 };
    for (const m of this.store.all("marks")) if (m.course_id === courseId) out[m.status]++;
    return out;
  }

  getAttendance({ course } = {}) {
    const c = this.course(course, { required: false });
    const marks = this.store.all("marks").filter((m) => !c || m.course_id === c.id).sort((a, b) => (a.date < b.date ? 1 : -1));
    const names = new Map(this.store.all("courses").map((x) => [x.id, x.name]));
    return {
      totals: c ? this.attendanceCounts(c.id) : undefined,
      marks: marks.map((m) => ({ date: m.date, status: m.status, course: names.get(m.course_id) ?? null, label: shortLabel(m.date) })),
    };
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
  // Pinned notes stay course-wide.
  addNote({ course, date, event_id, title, body = "", pinned = false }) {
    const c = this.course(course, { required: false });
    let session = date ?? null;
    let eventId = event_id ?? null;
    if (c && !date && !pinned) {
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
      title: title || numberedTitle(this.store, "Untitled"),
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

  // Older text of a note, newest first.
  noteVersions({ note_id }) {
    const n = this.row("notes", note_id);
    return this.store
      .all("note_versions")
      .filter((v) => v.note_id === n.id)
      .sort((a, b) => b.saved_at - a.saved_at)
      .map((v) => ({ version_id: v.id, title: v.title, body: v.body, saved_at: v.saved_at, reason: v.reason }));
  }

  // Put an older version back. The text it replaces becomes a version too.
  restoreNoteVersion({ version_id }) {
    const v = this.row("note_versions", version_id);
    const n = this.row("notes", v.note_id);
    if (!this.store.replica) this.store.keepVersion(n, { reason: "restore", force: true });
    return this.store.upsert("notes", { id: n.id, title: v.title, body: v.body });
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
        // Formatting (fonts, sizes, stars) is not text: search the words only.
        const text = plainText(n.body);
        const hay = `${n.title}\n${text}`.toLowerCase();
        const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
        return { n, text, score };
      })
      .filter((x) => x.score === words.length)
      .sort((a, b) => b.n.updated_at - a.n.updated_at)
      .slice(0, limit)
      .map(({ n, text }) => {
        const i = text.toLowerCase().indexOf(words[0]);
        const snippet = i >= 0 ? text.slice(Math.max(0, i - 60), i + 120) : text.slice(0, 160);
        return { ...this.describeNote(n), body: undefined, snippet };
      });
  }

  // One search over everything, calendar first: birthdays and appointments are
  // events, so "when is X's birthday" is answered before any note is read.
  // Then notes, Drive files and folders, and alarms.
  search({ query, limit = 10 }) {
    const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const words = norm(query).split(" ").filter(Boolean).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w));
    if (!words.length) throw new Error("query is required");
    const hit = (s) => { const h = norm(s); return words.every((w) => h.includes(w)); };
    const events = this.findEvents({ query, limit }).events;
    const notes = this.searchNotes({ query: words.join(" "), limit });
    const files = this.store.all("files").filter((f) => hit(f.name)).slice(0, limit)
      .map((f) => ({ file_id: f.id, name: f.name, folder_id: f.folder_id, course_id: f.course_id, note_id: f.note_id, size: f.size, mime: f.mime }));
    const folders = this.store.all("folders").filter((f) => hit(f.name)).slice(0, limit).map((f) => ({ folder_id: f.id, name: f.name, parent_id: f.parent_id }));
    const alarms = this.listAlarms().filter((a) => hit(a.label)).slice(0, limit);
    return { query, events, notes, files, folders, alarms };
  }

  // --- alarms ----------------------------------------------------------------

  listAlarms() {
    const data = this.data();
    return data.alarms
      .map((a) => ({ ...a, next_at: nextAlarm(a, data, this.clock(), this.tz) }))
      .sort((a, b) => (a.next_at ?? Infinity) - (b.next_at ?? Infinity));
  }

  // before: an event id, or a course name for every session of that course.
  setAlarm({ label, time, days, date, before, minutes_before, enabled, alarm_id }) {
    // An edit changes only what it is given: "turn it off" keeps its time,
    // label and lecture; "make it 9" keeps its label.
    const old = alarm_id ? this.row("alarms", alarm_id) : null;
    if (old) {
      const patch = { id: old.id };
      if (label !== undefined) patch.label = label || "Alarm";
      if (enabled !== undefined) patch.enabled = enabled;
      const lead = old.lead_event_id || old.lead_course_id;
      if (!before && (time !== undefined || date !== undefined || days !== undefined)) {
        Object.assign(patch, { time: time ?? old.time, date: date !== undefined ? date : days?.length ? null : old.date, days: (days ?? (lead ? [] : old.days ?? [])).map(parseWeekday), lead_event_id: null, lead_course_id: null, lead_minutes: null });
      } else if (!before && minutes_before !== undefined && lead) patch.lead_minutes = minutes_before;
      if (!before) return this.store.upsert("alarms", patch);
      label ??= old.label;
      enabled ??= old.enabled ? true : false;
      minutes_before ??= old.lead_minutes ?? undefined;
    }
    enabled ??= true;
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

  // One alarm per lecture (kind "lecture"), N minutes before every session.
  // minutes null/0 turns them off. Tutorials that follow a lecture are skipped
  // on purpose: you are already in the room.
  setLectureReminders({ minutes }) {
    const on = Number(minutes) > 0;
    const lectures = this.store.all("events").filter((e) => e.kind === "lecture");
    const existing = this.store.all("alarms").filter((a) => a.lead_event_id && lectures.some((e) => e.id === a.lead_event_id));
    const out = [];
    for (const ev of lectures) {
      const c = ev.course_id ? this.store.get("courses", ev.course_id) : null;
      const room = (ev.location || c?.location || "").split(" · ")[0];
      // Says what starts and when, e.g. "Typography (1) · lecture 8:30 AM · B729";
      // the alarm itself rings `minutes` earlier.
      const label = [c?.name || ev.title || "Lecture", `lecture ${to12h(ev.start_time)}`, room].filter(Boolean).join(" · ");
      const a = existing.find((x) => x.lead_event_id === ev.id);
      if (a) out.push(this.store.upsert("alarms", { id: a.id, enabled: on ? 1 : 0, ...(on ? { lead_minutes: Number(minutes), label } : {}) }));
      else if (on) out.push(this.store.upsert("alarms", { label, lead_event_id: ev.id, lead_minutes: Number(minutes), enabled: 1, days: [] }));
    }
    this.store.setMeta("lecture_reminder_min", on ? Number(minutes) : 0);
    return out;
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
      .map((t) => ({
        ...t,
        scheduled: t.state === "running" && t.start_at > now,
        remaining_s: t.state === "running" ? Math.max(0, Math.ceil((t.ends_at - Math.max(now, t.start_at ?? 0)) / 1000)) : t.state === "idle" ? t.duration_s : t.remaining_s,
      }));
  }

  // at: "HH:MM" today (tomorrow if past) in the user's zone, or epoch ms.
  // id: a set id, so two devices snoozing the same ring make one timer.
  startTimer({ minutes, seconds, hours, label, persistent, at, id }) {
    const duration = Math.round((Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0));
    if (duration <= 0) throw new Error("give hours, minutes or seconds");
    const now = this.clock();
    let start = now;
    if (at !== undefined && at !== null && at !== "") {
      if (typeof at === "number") start = at;
      else {
        const hm = parseTime(String(at));
        if (hm === null) throw new Error("at must be HH:MM");
        const p = localParts(now, this.tz);
        start = now + (hm - p.minutes) * 60000 - p.seconds * 1000;
        if (start <= now) start += 86400000;
      }
    }
    return this.store.upsert("timers", {
      ...(id ? { id } : {}),
      label: label || `${fmtDuration(duration)} timer`,
      duration_s: duration,
      state: "running",
      start_at: start > now ? start : null,
      ends_at: start + duration * 1000,
      remaining_s: null,
      persistent: persistent ? 1 : 0,
    });
  }

  // A saved timer that rings as soon as it is created is pointless; this
  // makes one without starting it.
  saveTimer({ minutes, seconds, hours, label }) {
    const duration = Math.round((Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0));
    if (duration <= 0) throw new Error("give hours, minutes or seconds");
    return this.store.upsert("timers", { label: label || `${fmtDuration(duration)} timer`, duration_s: duration, state: "idle", ends_at: null, remaining_s: null, persistent: 1 });
  }

  // action: start | pause | resume | restart | reset | add_minute | stop | done
  updateTimer({ timer_id, action }) {
    const t = this.row("timers", timer_id);
    const now = this.clock();
    const run = (secs) => this.store.upsert("timers", { id: t.id, state: "running", start_at: null, ends_at: now + secs * 1000, remaining_s: null });
    if (action === "pause" && t.state === "running")
      return this.store.upsert("timers", { id: t.id, state: "paused", remaining_s: Math.max(0, Math.ceil((t.ends_at - Math.max(now, t.start_at ?? 0)) / 1000)), ends_at: null, start_at: null });
    if (action === "resume" && t.state === "paused") return run(t.remaining_s);
    if (action === "start" || action === "restart") return run(t.duration_s);
    if (action === "add_minute" && t.state === "running") return this.store.upsert("timers", { id: t.id, ends_at: t.ends_at + 60000 });
    if (action === "add_minute" && t.state === "paused") return this.store.upsert("timers", { id: t.id, remaining_s: t.remaining_s + 60 });
    if (action === "reset") return t.persistent ? this.store.upsert("timers", { id: t.id, ...finishedTimer(t) }) : this.store.remove("timers", t.id);
    if (action === "done") return this.store.upsert("timers", { id: t.id, ...finishedTimer(t) });
    if (action === "stop") return this.store.remove("timers", t.id);
    throw new Error(`cannot ${action} a ${t.state} timer`);
  }

  // --- world clock ---------------------------------------------------------

  // Minutes a zone is ahead of UTC at `ms`.
  offsetMin(zone, ms = this.clock()) {
    const p = localParts(ms, zone);
    return Math.round((Date.UTC(...p.date.split("-").map((n, i) => (i === 1 ? n - 1 : +n))) + p.minutes * 60000 + p.seconds * 1000 - ms) / 60000);
  }

  // Clocks in display order with their current time, day and difference
  // from the home zone (the one Hourglass runs on).
  listClocks() {
    const now = this.clock();
    const home = this.tz;
    const homeOff = this.offsetMin(home, now);
    const homeDate = localParts(now, home).date;
    return this.store
      .all("clocks")
      .sort((a, b) => a.position - b.position || a.updated_at - b.updated_at)
      .map((c) => {
        const p = localParts(now, c.zone);
        const off = this.offsetMin(c.zone, now);
        const diff = off - homeOff;
        return {
          ...c,
          label: c.label || cityOf(c.zone),
          home: !!c.home || c.zone === home,
          offset_min: off,
          diff_min: diff,
          date: p.date,
          time: p.time,
          time_12h: to12h(p.time),
          day: p.date === homeDate ? "Today" : p.date > homeDate ? "Tomorrow" : "Yesterday",
        };
      });
  }

  addClock({ zone, label }) {
    const z = resolveZone(zone);
    const existing = this.store.all("clocks").find((c) => c.zone === z);
    if (existing) return existing;
    const pos = Math.max(-1, ...this.store.all("clocks").map((c) => c.position)) + 1;
    return this.store.upsert("clocks", { zone: z, label: label || cityOf(z), position: pos });
  }

  // Make one clock the app's time zone (all devices follow it).
  setHomeZone({ zone, clock_id }) {
    const target = clock_id ? this.row("clocks", clock_id) : this.addClock({ zone });
    for (const c of this.store.all("clocks")) {
      if (c.id === target.id && !c.home) this.store.upsert("clocks", { id: c.id, home: 1 });
      else if (c.id !== target.id && c.home) this.store.upsert("clocks", { id: c.id, home: 0 });
    }
    return this.listClocks();
  }

  removeClock({ clock_id }) {
    return this.store.remove("clocks", this.row("clocks", clock_id).id);
  }

  // Zones matching a city/region search, with their current offset.
  searchZones({ query = "", limit = 30 } = {}) {
    const q = query.trim().toLowerCase().replace(/\s+/g, "_");
    const now = this.clock();
    return Intl.supportedValuesOf("timeZone")
      .filter((z) => !q || z.toLowerCase().includes(q))
      .slice(0, limit)
      .map((z) => ({ zone: z, city: cityOf(z), offset_min: this.offsetMin(z, now), time_12h: to12h(localParts(now, z).time) }));
  }

  // --- settings --------------------------------------------------------------

  // From the synced lecture alarms, so every device agrees.
  lectureReminderMin() {
    const lectures = new Set(this.store.all("events").filter((e) => e.kind === "lecture").map((e) => e.id));
    const a = this.store.all("alarms").find((x) => lectures.has(x.lead_event_id) && x.enabled);
    return a ? a.lead_minutes : 0;
  }

  // Per-device preferences (not synced). Lecture reminders are synced alarms.
  settings() {
    return {
      tz: this.tz,
      time_format: this.store.meta("time_format") || "12h",
      week_start: this.store.meta("week_start") || 6, // ISO weekday; 6 = Saturday
      sound: this.store.meta("sound") ?? true,
      ringtone: this.ringtone,
      lecture_reminder_min: this.lectureReminderMin(),
    };
  }

  // The alarm sound, synced: a built-in name or a ringtones row id.
  get ringtone() {
    const v = this.store.get("prefs", "ringtone");
    const r = v && !v.deleted ? v.value : null;
    if (BUILTIN_RINGTONES.includes(r)) return r;
    const row = r ? this.store.get("ringtones", r) : null;
    return row && !row.deleted ? r : "classic";
  }

  listRingtones() {
    const current = this.ringtone;
    return [
      ...BUILTIN_RINGTONES.map((n) => ({ id: n, name: n[0].toUpperCase() + n.slice(1), kind: "builtin", selected: n === current })),
      ...this.store
        .all("ringtones")
        .sort((a, b) => b.updated_at - a.updated_at)
        .map((r) => ({ ...r, selected: r.id === current })),
    ];
  }

  setRingtone({ ringtone }) {
    const r = String(ringtone ?? "").trim();
    const row = BUILTIN_RINGTONES.includes(r) ? null : this.store.get("ringtones", r) ?? this.store.all("ringtones").find((x) => x.name.toLowerCase() === r.toLowerCase());
    if (!BUILTIN_RINGTONES.includes(r) && (!row || row.deleted)) throw new Error(`no ringtone with id or name ${r}`);
    this.store.upsert("prefs", { id: "ringtone", value: row ? row.id : r });
    return this.listRingtones().find((x) => x.selected);
  }

  removeRingtone({ ringtone_id }) {
    const row = this.store.get("ringtones", ringtone_id);
    if (!row || row.deleted) throw new Error(`no ringtone with id ${ringtone_id}`);
    if (this.store.get("prefs", "ringtone")?.value === row.id) this.store.upsert("prefs", { id: "ringtone", value: "classic" });
    this.store.remove("ringtones", row.id);
    return { ok: true, removed: row.name };
  }

  setSettings({ tz, time_format, week_start, sound, lecture_reminder_min, ringtone }) {
    if (typeof ringtone === "string") this.setRingtone({ ringtone });
    if (tz) {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      this.store.setMeta("tz", tz);
    }
    if (time_format === "12h" || time_format === "24h") this.store.setMeta("time_format", time_format);
    if ([1, 6, 7].includes(Number(week_start))) this.store.setMeta("week_start", Number(week_start));
    if (typeof sound === "boolean") this.store.setMeta("sound", sound);
    if (lecture_reminder_min !== undefined) this.setLectureReminders({ minutes: Number(lecture_reminder_min) || 0 });
    return this.settings();
  }
}

function cityOf(zone) {
  return zone.split("/").pop().replace(/_/g, " ");
}

// Accept an IANA zone ("America/New_York") or a city name ("new york", "Tokyo").
// A zone the app already uses ("Etc/UTC" from the system) is taken as is;
// anything else is looked up like a city.
function eventZone(input) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: input });
    if (/\//.test(input) || input === "UTC") return input;
  } catch {}
  return resolveZone(input);
}

function resolveZone(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("zone is required, e.g. Asia/Tokyo or a city name");
  const zones = Intl.supportedValuesOf("timeZone");
  const exact = zones.find((z) => z.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const q = raw.toLowerCase().replace(/\s+/g, "_");
  const hits = zones.filter((z) => z.toLowerCase().split("/").pop() === q);
  if (hits.length) return hits[0];
  const partial = zones.filter((z) => z.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`"${raw}" matches several zones: ${partial.slice(0, 8).join(", ")}`);
  throw new Error(`no time zone for "${raw}"`);
}

function to12h(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function localWeekday(date) {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

function addMinutes(time, m) {
  const t = parseTime(time) + m;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// "once", "daily", "every Tue, Thu", "monthly on day 15", "yearly on 7 Feb", "... until 2027-06-30"
export function describeRepeat(ev) {
  const r = ev.repeat;
  if (!r) return "once";
  const n = r.interval > 1 ? r.interval : 0;
  const [, m, d] = ev.start_date.split("-").map(Number);
  let s;
  if (r.freq === "daily") s = n ? `every ${n} days` : "daily";
  else if (r.freq === "monthly") s = `${n ? `every ${n} months` : "monthly"} on day ${d}`;
  else if (r.freq === "yearly") s = `${n ? `every ${n} years` : "yearly"} on ${d} ${MONTHS[m - 1]}`;
  else s = `${n ? `every ${n} weeks on` : "every"} ${(r.days?.length ? r.days : [localWeekday(ev.start_date)]).map((w) => WEEKDAYS[w - 1]).join(", ")}`;
  return r.until ? `${s} until ${r.until}` : s;
}

function normalizeRepeat(repeat, startDate) {
  if (!repeat || repeat === "none") return null;
  if (typeof repeat === "string") repeat = { freq: repeat };
  const out = { freq: repeat.freq || "weekly" };
  if (repeat.interval > 1) out.interval = Number(repeat.interval);
  if (out.freq === "weekly") out.days = repeat.days?.length ? repeat.days.map(parseWeekday) : [localWeekday(startDate)];
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
