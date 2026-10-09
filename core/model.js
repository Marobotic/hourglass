import { isDate, isTime } from "./dates.js";

export const PALETTE = ["#B14242", "#D66E36", "#F0BE66", "#4A8B8B", "#7E6BAF", "#5B8C4A", "#C2587E", "#8A8A8A"];
export const KINDS = ["lecture", "lab", "tutorial", "exam", "event"];
export const MARKS = ["attended", "absent", "off"];
export const REPEATS = ["daily", "weekly", "monthly", "yearly"];

// The marks row id for a session: per course and day, so a lecture and its
// tutorial on the same day share one mark.
export const markId = (courseId, eventId, date) => `${courseId || eventId}:${date}`;

// Column definitions: [name, type, default]. type: text | int | bool | json.
export const TABLES = {
  courses: [
    ["name", "text", ""],
    ["code", "text", null],
    ["color", "text", PALETTE[0]],
    ["location", "text", null],
    ["teacher", "text", null],
    ["archived", "bool", 0],
  ],
  events: [
    ["course_id", "text", null],
    ["title", "text", ""],
    ["kind", "text", "event"],
    ["location", "text", null],
    ["start_date", "text", null],
    ["start_time", "text", null],
    ["end_time", "text", null],
    ["repeat", "json", null],
    ["exceptions", "json", []],
    // The zone start_time/end_time are in: "08:00 Africa/Cairo" stays 08:00 in
    // Cairo whatever zone the app shows, and converts for display. null = the
    // app's zone at the time (rows from before this column).
    ["tz", "text", null],
  ],
  notes: [
    ["course_id", "text", null],
    ["event_id", "text", null],
    ["session_date", "text", null],
    ["title", "text", ""],
    ["body", "text", ""],
    ["pinned", "bool", 0],
  ],
  alarms: [
    ["label", "text", ""],
    ["time", "text", null],
    ["days", "json", []],
    ["date", "text", null],
    ["lead_event_id", "text", null],
    ["lead_course_id", "text", null],
    ["lead_minutes", "int", null],
    ["enabled", "bool", 1],
  ],
  clocks: [
    ["zone", "text", ""],
    ["label", "text", ""],
    ["position", "int", 0],
    ["home", "bool", 0], // the app's time zone, on every device
  ],
  timers: [
    ["label", "text", ""],
    ["duration_s", "int", 0],
    ["state", "text", "running"], // running | paused | idle (saved, not running) | done
    ["ends_at", "int", null],
    ["remaining_s", "int", null],
    ["persistent", "bool", 0], // saved timer: back to idle when it finishes
    ["start_at", "int", null], // scheduled: counts down from here (ends_at = start_at + duration)
  ],
  // Alarm sounds of the account: uploaded files and songs from Jukebox.
  // The audio (a 30 s WAV) lives on the server: GET /api/ringtones/<id>/audio.
  ringtones: [
    ["name", "text", ""],
    ["kind", "text", "upload"], // upload | song
    ["artist", "text", null],
    ["song_id", "text", null],
    ["duration_s", "int", 0],
  ],
  // Older text of a note, written by the server only: the state before an
  // editing session (at most one per 10 minutes of edits), and whatever lost
  // when two devices edited at once. Restoring one is an ordinary note edit.
  note_versions: [
    ["note_id", "text", null],
    ["title", "text", ""],
    ["body", "text", ""],
    ["saved_at", "int", 0], // when this text was last edited
    ["reason", "text", "edit"], // edit | conflict | restore
  ],
  // One session of a course marked attended, absent or off (no class that
  // day). id = "<course_id or event_id>:<date>", so every device writes the
  // same row; removing it clears the mark.
  marks: [
    ["course_id", "text", null],
    ["event_id", "text", null],
    ["date", "text", null],
    ["status", "text", "attended"], // attended | absent | off
  ],
  // Drive: folders (nested by parent_id) and files. A file's bytes live on
  // the server (GET /api/files/<id>/raw); the row syncs. note_id: attached to
  // a note (shown in it as ![name](hgfile:<id>) or [name](hgfile:<id>)).
  folders: [
    ["name", "text", ""],
    ["parent_id", "text", null],
  ],
  files: [
    ["name", "text", ""],
    ["folder_id", "text", null],
    ["size", "int", 0],
    ["mime", "text", "application/octet-stream"],
    ["note_id", "text", null],
    ["course_id", "text", null], // in that course's Drive folder
  ],
  // Synced preferences, one row per key (id = key). "ringtone": a built-in
  // name or a ringtones row id.
  prefs: [["value", "text", null]],
};

export const BUILTIN_RINGTONES = ["classic", "klaxon", "siren", "digital", "rising", "bell"];

export const TABLE_NAMES = Object.keys(TABLES);

export const newId = () => crypto.randomUUID();

// Fill defaults, coerce types, drop unknown fields. Throws on invalid rows.
export function normalize(table, input, { partial = false } = {}) {
  const cols = TABLES[table];
  if (!cols) throw new Error(`unknown table: ${table}`);
  const row = { id: input.id || newId() };
  for (const [name, type, def] of cols) {
    let v = input[name];
    if (v === undefined) {
      if (partial) continue;
      v = typeof def === "object" && def !== null ? structuredClone(def) : def;
    }
    if (v !== null) {
      if (type === "int") v = Math.round(Number(v));
      if (type === "bool") v = v ? 1 : 0;
      if (type === "text") v = String(v);
      if (type === "json" && typeof v === "string") v = JSON.parse(v);
    }
    row[name] = v;
  }
  row.updated_at = Number(input.updated_at) || Date.now();
  row.deleted = input.deleted ? 1 : 0;
  if (!partial && !row.deleted) validate(table, row);
  return row;
}

export function validate(table, r) {
  const fail = (m) => {
    throw new Error(`${table}: ${m}`);
  };
  if (table === "courses" && !r.name.trim()) fail("name is required");
  if (table === "events") {
    if (!isDate(r.start_date)) fail("start_date must be YYYY-MM-DD");
    if (!isTime(r.start_time) || !isTime(r.end_time)) fail("start_time and end_time must be HH:MM");
    if (!KINDS.includes(r.kind)) fail(`kind must be one of ${KINDS.join(", ")}`);
    if (!r.title && !r.course_id) fail("title or course_id is required");
    if (r.repeat) {
      if (!REPEATS.includes(r.repeat.freq)) fail(`repeat.freq must be one of ${REPEATS.join(", ")}`);
      if (r.repeat.days?.some((d) => d < 1 || d > 7)) fail("repeat.days are ISO weekdays 1-7");
      if (r.repeat.until && !isDate(r.repeat.until)) fail("repeat.until must be YYYY-MM-DD");
    }
  }
  if (table === "notes" && r.session_date && !isDate(r.session_date)) fail("session_date must be YYYY-MM-DD");
  if (table === "alarms") {
    if (!r.lead_event_id && !r.lead_course_id && !isTime(r.time)) fail("time (HH:MM), lead_event_id or lead_course_id is required");
    if (r.date && !isDate(r.date)) fail("date must be YYYY-MM-DD");
  }
  if (table === "ringtones" && !r.name.trim()) fail("name is required");
  if (table === "events" && r.tz) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: r.tz });
    } catch {
      fail(`unknown time zone: ${r.tz}`);
    }
  }
  if (table === "marks") {
    if (!isDate(r.date)) fail("date must be YYYY-MM-DD");
    if (!MARKS.includes(r.status)) fail(`status must be one of ${MARKS.join(", ")}`);
    if (!r.course_id && !r.event_id) fail("course_id or event_id is required");
  }
  if (table === "note_versions" && !r.note_id) fail("note_id is required");
  if ((table === "folders" || table === "files") && !r.name.trim()) fail("name is required");
  if (table === "timers" && !(r.duration_s > 0)) fail("duration_s must be positive");
  if (table === "clocks") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: r.zone });
    } catch {
      fail(`unknown time zone: ${r.zone}`);
    }
  }
}

// Parse "Tue", "tuesday", 2 -> ISO weekday number.
export function parseWeekday(v) {
  if (typeof v === "number") return v;
  const names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const i = names.indexOf(String(v).trim().toLowerCase().slice(0, 3));
  if (i < 0) throw new Error(`bad weekday: ${v}`);
  return i + 1;
}
