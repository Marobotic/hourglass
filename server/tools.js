// The single list of operations exposed to AIs. MCP registers each one as a
// tool; REST serves the same list at POST /api/actions/<name>.
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");
const time = z.string().regex(/^\d{1,2}:\d{2}$/).describe("24h HH:MM, the user's local time");
const weekday = z.union([z.string(), z.number()]).describe('Weekday: "Mon".."Sun", full name, or ISO number 1=Mon..7=Sun');
const course = z.string().describe("Course name, code or id. Partial names work when unambiguous");
const repeat = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly", "yearly"]).describe("monthly and yearly repeat on the start date's day (yearly: birthdays, anniversaries)"),
    days: z.array(weekday).optional().describe("For weekly; defaults to the start date's weekday"),
    interval: z.number().int().min(1).optional().describe("2 = every other day/week/month/year"),
    until: date.optional().describe("Last date, inclusive (e.g. end of term). Omit to repeat forever"),
  })
  .describe("Omit for a one-off event");

export const INSTRUCTIONS = `Hourglass is the user's calendar, notes, alarms and timers.
Model: courses are folders (e.g. a university module). Events are one-off or recurring blocks of time, usually lectures of a course. Notes are Markdown (one line per line; fonts and sizes as <span style="font-family: Lora; font-size: 20px">, underline as <u>: keep those when rewriting a note), live in a course, and are stamped with a session_date: the date of the lecture they were written for.
To find anything by name (a person, a birthday, a file) use search: it looks in the calendar first, then notes, Drive and alarms.
Start with whats_now for anything about "now", "today" or "next"; get_schedule for a week; find_events for a named event at any date ("when is X's birthday", "when is my dentist"). Events are never in notes: do not search notes for them. Times in results are shown in the app's zone (now.tz). Each event also has its own zone (event_tz): its start/end are fixed in that zone, so pass times in the event's zone when you change them (e.g. a Cairo lecture at 08:00 stays "08:00" with tz Africa/Cairo).
To adjust the schedule: get_schedule or list_courses to find event ids, then update_event / add_event / remove_event. Mark days with mark_session (attended, absent, off).
Anything that comes back every year (a birthday, an anniversary) is ONE event with repeat {freq: "yearly"} and no until, starting on the next (or the original) date; never add one event per year. The same goes for monthly things (rent, a bill): one event with repeat {freq: "monthly"}.
When removing a single lecture of a recurring series use remove_event with scope "occurrence" and the date; only use scope "series" when the user wants the whole thing gone.
Confirm destructive actions (remove_event series, remove_course, delete_note) with the user first.`;

export const TOOLS = [
  {
    name: "whats_now",
    title: "What's on now",
    description: "The current session (with its notes), the next event within 12 hours (nothing later: day_off is true when today is free), today's timeline with attendance marks, running timers and next alarms.",
    input: {},
    readOnly: true,
    run: (s) => s.whatsNow(),
  },
  {
    name: "get_schedule",
    title: "Get schedule",
    description: "Every event occurrence between two dates. Defaults to the current week (Mon-Sun).",
    input: { from: date.optional(), to: date.optional() },
    readOnly: true,
    run: (s, a) => s.schedule(a),
  },
  {
    name: "search",
    title: "Search everything",
    description: "One search over the calendar (events: birthdays, appointments, lectures - with their next date), notes (with a snippet), Drive files and folders, and alarms. Use this first when the user names a person or thing and you don't know where it lives.",
    input: { query: z.string().describe('A name or words, e.g. "sara birthday", "dentist", "lab report"') },
    readOnly: true,
    run: (s, a) => s.search(a),
  },
  {
    name: "find_events",
    title: "Find events",
    description: `Find events by name at any date: birthdays, appointments, exams, lectures. Every word of query must appear in the title or course (case and punctuation ignored, "ashwasky" finds "Ashwasky's birthday"). Returns each event's rule (e.g. "yearly on 7 Feb") and its next date. Use this for any "when is ..." question. No query lists every event.`,
    input: { query: z.string().optional().describe('A name or word from the title, e.g. "ashwasky", "dentist", "birthday"') },
    readOnly: true,
    run: (s, a) => s.findEvents(a),
  },
  {
    name: "list_courses",
    title: "List courses",
    description: "Courses with their recurring events, next session and note count.",
    input: {},
    readOnly: true,
    run: (s) => s.listCourses(),
  },
  {
    name: "add_course",
    title: "Add course",
    description: 'Create a course, optionally with its weekly schedule in one call, e.g. schedule [{day:"Tue", start:"08:00", end:"10:00"}].',
    input: {
      name: z.string(),
      code: z.string().optional(),
      color: z.string().optional().describe("#RRGGBB; picked automatically if omitted"),
      location: z.string().optional().describe("Default room"),
      teacher: z.string().optional(),
      schedule: z
        .array(
          z.object({
            day: weekday,
            start: time,
            end: time,
            kind: z.enum(["lecture", "lab", "tutorial", "exam", "event"]).optional(),
            location: z.string().optional(),
          }),
        )
        .optional(),
      term_start: date.optional().describe("First week of teaching; defaults to today"),
      term_end: date.optional().describe("Recurring sessions stop after this date"),
      tz: z.string().optional().describe("IANA zone the times are in (Africa/Cairo). Defaults to the app's zone. The event stays at that wall-clock time in that zone even if the app later shows another zone"),
    },
    run: (s, a) => s.addCourse(a),
  },
  {
    name: "update_course",
    title: "Update course",
    description: "Rename or change a course's code, colour, room, teacher, or archive it.",
    input: {
      course,
      name: z.string().optional(),
      code: z.string().optional(),
      color: z.string().optional(),
      location: z.string().optional(),
      teacher: z.string().optional(),
      archived: z.boolean().optional(),
    },
    run: (s, a) => s.updateCourse(a),
  },
  {
    name: "remove_course",
    title: "Remove course",
    description: "Delete a course and its events. Its notes are kept. Confirm with the user first.",
    input: { course },
    destructive: true,
    run: (s, a) => s.removeCourse(a),
  },
  {
    name: "add_event",
    title: "Add event",
    description: "Add a one-off or recurring event. Attach it to a course for lectures, labs, exams.",
    input: {
      title: z.string().optional().describe("Defaults to the course name"),
      course: course.optional(),
      kind: z.enum(["lecture", "lab", "tutorial", "exam", "event"]).optional(),
      date: date.optional().describe("First (or only) date; defaults to today"),
      start: time,
      end: time.optional().describe("Defaults to one hour after start"),
      location: z.string().optional(),
      repeat: repeat.optional(),
      tz: z.string().optional().describe("IANA zone the times are in (Africa/Cairo). Defaults to the app's zone. The event stays at that wall-clock time in that zone even if the app later shows another zone"),
    },
    run: (s, a) => s.addEvent(a),
  },
  {
    name: "update_event",
    title: "Update event",
    description: "Change an event's time, date, title, room, course or repeat rule. Changes apply to the whole series.",
    input: {
      event_id: z.string(),
      title: z.string().optional(),
      course: course.nullable().optional().describe("null detaches it from its course"),
      kind: z.enum(["lecture", "lab", "tutorial", "exam", "event"]).optional(),
      date: date.optional(),
      start: time.optional(),
      end: time.optional(),
      location: z.string().optional(),
      repeat: repeat.nullable().optional().describe("null makes it a one-off"),
      tz: z.string().nullable().optional().describe("IANA zone the start/end times are in; usually leave as is"),
    },
    run: (s, a) => s.updateEvent(a),
  },
  {
    name: "remove_event",
    title: "Remove event",
    description: 'Remove one session of a recurring event (scope "occurrence" + date) or the whole event (scope "series").',
    input: { event_id: z.string(), scope: z.enum(["occurrence", "series"]).default("series"), date: date.optional() },
    destructive: true,
    run: (s, a) => s.removeEvent(a),
  },
  {
    name: "mark_session",
    title: "Mark attendance",
    description: 'Mark one day of a course: "attended", "absent" or "off" (no class that day; it then disappears from Now). "none" clears the mark. Pass course (or event_id) and date (defaults to today).',
    input: {
      course: course.optional(),
      event_id: z.string().optional(),
      date: date.optional(),
      status: z.enum(["attended", "absent", "off", "none"]),
    },
    run: (s, a) => s.markSession(a),
  },
  {
    name: "get_attendance",
    title: "Get attendance",
    description: "Attendance marks (attended / absent / off) by date, for one course with totals, or for all courses.",
    input: { course: course.optional() },
    readOnly: true,
    run: (s, a) => s.getAttendance(a),
  },
  {
    name: "get_notes",
    title: "Get notes",
    description: "Notes filtered by course and/or session date, newest first, with full bodies.",
    input: { course: course.optional(), date: date.optional(), limit: z.number().int().min(1).max(100).optional() },
    readOnly: true,
    run: (s, a) => s.getNotes(a),
  },
  {
    name: "search_notes",
    title: "Search notes",
    description: "Full-text search over note titles and bodies. Returns snippets; use get_notes for full text.",
    input: { query: z.string(), limit: z.number().int().min(1).max(100).optional() },
    readOnly: true,
    run: (s, a) => s.searchNotes(a),
  },
  {
    name: "add_note",
    title: "Add note",
    description: "Create a Markdown note. With a course and no date it attaches to today's session when the course meets today.",
    input: {
      course: course.optional(),
      date: date.optional().describe("Session date this note belongs to"),
      title: z.string().optional().describe('Defaults to the session label, e.g. "Tue 30 Sep"'),
      body: z.string().optional(),
      pinned: z.boolean().optional().describe("Pinned notes show in every session of the course"),
    },
    run: (s, a) => s.addNote(a),
  },
  {
    name: "append_note",
    title: "Append to note",
    description: "Append a paragraph to an existing note without rewriting it.",
    input: { note_id: z.string(), text: z.string() },
    run: (s, a) => s.appendNote(a),
  },
  {
    name: "update_note",
    title: "Update note",
    description: "Replace a note's title or body, pin it, or move it to another course or session.",
    input: {
      note_id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      pinned: z.boolean().optional(),
      course: course.optional(),
      date: date.nullable().optional(),
    },
    run: (s, a) => s.updateNote(a),
  },
  {
    name: "list_drive",
    title: "List Drive",
    description: "The user's Drive: folders and files in one folder (omit folder_id for the top). Files are downloaded at GET /api/files/<id>/raw.",
    input: { folder_id: z.string().optional(), course_id: z.string().optional().describe("A course's Drive folder") },
    readOnly: true,
    run: (s, a) => s.listDrive(a),
  },
  {
    name: "move_file",
    title: "Move Drive file",
    description: "Put a Drive file in a course's folder (course: name or id; null takes it out) or in a folder (folder_id; null = the top).",
    input: { file_id: z.string(), course: z.string().nullable().optional(), folder_id: z.string().nullable().optional() },
    run: (s, a) => s.moveFile(a),
  },
  {
    name: "move_folder",
    title: "Move Drive folder",
    description: "Put a Drive folder inside another folder (parent_id), or at the top (parent_id null). A folder can't go inside itself.",
    input: { folder_id: z.string(), parent_id: z.string().nullable().optional() },
    run: (s, a) => s.moveFolder(a),
  },
  {
    name: "add_folder",
    title: "Add Drive folder",
    description: "Make a folder in the user's Drive, at the top or inside parent_id.",
    input: { name: z.string(), parent_id: z.string().optional() },
    run: (s, a) => s.addFolder(a),
  },
  {
    name: "remove_folder",
    title: "Delete Drive folder",
    description: "Delete a Drive folder with everything in it. Confirm with the user first.",
    input: { folder_id: z.string() },
    destructive: true,
    run: (s, a) => s.removeFolder(a),
  },
  {
    name: "note_versions",
    title: "Note history",
    description: "Older versions of a note (text before earlier edits, and text that lost when two devices edited at once), newest first.",
    input: { note_id: z.string() },
    readOnly: true,
    run: (s, a) => s.noteVersions(a),
  },
  {
    name: "restore_note_version",
    title: "Restore note version",
    description: "Put an older version of a note back. The current text is kept as a version, so this can be undone.",
    input: { version_id: z.string() },
    run: (s, a) => s.restoreNoteVersion(a),
  },
  {
    name: "delete_note",
    title: "Delete note",
    description: "Delete a note. Confirm with the user first.",
    input: { note_id: z.string() },
    destructive: true,
    run: (s, a) => s.deleteNote(a),
  },
  {
    name: "list_alarms",
    title: "List alarms",
    description: "Alarms with the next time each will ring (next_at, ms epoch).",
    input: {},
    readOnly: true,
    run: (s) => s.listAlarms(),
  },
  {
    name: "set_alarm",
    title: "Set alarm",
    description: 'Create or edit an alarm: at a time (daily, on weekdays, or on one date), or N minutes before every session of a course/event (before + minutes_before).',
    input: {
      alarm_id: z.string().optional().describe("Pass to edit an existing alarm"),
      label: z.string().optional(),
      time: time.optional(),
      days: z.array(weekday).optional().describe("Repeat on these weekdays; empty = every day, or once with date"),
      date: date.optional().describe("One-off alarm date"),
      before: z.string().optional().describe("Course name or event id to ring before"),
      minutes_before: z.number().int().min(0).optional(),
      enabled: z.boolean().optional(),
    },
    run: (s, a) => s.setAlarm(a),
  },
  {
    name: "set_lecture_reminders",
    title: "Lecture reminders",
    description: "Ring N minutes before every lecture (one alarm per lecture event). minutes 0 turns them off.",
    input: { minutes: z.number().int().min(0).max(240) },
    run: (s, a) => s.setLectureReminders(a),
  },
  {
    name: "remove_alarm",
    title: "Remove alarm",
    description: "Delete an alarm.",
    input: { alarm_id: z.string() },
    destructive: true,
    run: (s, a) => s.removeAlarm(a),
  },
  {
    name: "list_ringtones",
    title: "List alarm ringtones",
    description: "Alarm sounds: the built-in ones plus uploads and songs from Jukebox. selected marks the one alarms ring with on every device.",
    input: {},
    readOnly: true,
    run: (s) => s.listRingtones(),
  },
  {
    name: "set_ringtone",
    title: "Set alarm ringtone",
    description: "Choose the alarm sound for every device: a built-in name (classic, klaxon, siren, digital, rising, bell) or a ringtone id or name from list_ringtones.",
    input: { ringtone: z.string() },
    run: (s, a) => s.setRingtone(a),
  },
  {
    name: "remove_ringtone",
    title: "Delete ringtone",
    description: "Delete an uploaded or song ringtone (not a built-in). If it was selected, alarms go back to classic.",
    input: { ringtone_id: z.string() },
    destructive: true,
    run: (s, a) => s.removeRingtone(a),
  },
  {
    name: "world_clock",
    title: "World clock",
    description: "The user's world clocks: current time and day in each, and the difference from their home time zone.",
    input: {},
    readOnly: true,
    run: (s) => s.listClocks(),
  },
  {
    name: "add_clock",
    title: "Add world clock",
    description: "Add a city to the world clock. zone: IANA id (Asia/Tokyo) or a city name (Tokyo, New York).",
    input: { zone: z.string(), label: z.string().optional() },
    run: (s, a) => s.addClock(a),
  },
  {
    name: "set_home_zone",
    title: "Set the app's time zone",
    description: "Make a city the time zone Hourglass uses on every device (schedule, now, alarms). zone: IANA id or city name, or clock_id.",
    input: { zone: z.string().optional(), clock_id: z.string().optional() },
    run: (s, a) => s.setHomeZone(a),
  },
  {
    name: "remove_clock",
    title: "Remove world clock",
    description: "Remove a city from the world clock.",
    input: { clock_id: z.string() },
    destructive: true,
    run: (s, a) => s.removeClock(a),
  },
  {
    name: "list_timers",
    title: "List timers",
    description: "Timers: running (scheduled: true if it has not started yet), paused, and idle saved timers (persistent) waiting to be started, with seconds remaining.",
    input: {},
    readOnly: true,
    run: (s) => s.listTimers(),
  },
  {
    name: "start_timer",
    title: "Start timer",
    description: "Start a countdown timer; it rings and notifies on all the user's devices. persistent: keep it as a saved timer to reuse after it rings. at: \"HH:MM\" to start it later (scheduled timer).",
    input: { hours: z.number().optional(), minutes: z.number().optional(), seconds: z.number().optional(), label: z.string().optional(), persistent: z.boolean().optional(), at: z.string().optional() },
    run: (s, a) => s.startTimer(a),
  },
  {
    name: "save_timer",
    title: "Save a timer",
    description: "Create a saved timer (for example \"Tea, 4 min\") without starting it; start it later with update_timer action start.",
    input: { hours: z.number().optional(), minutes: z.number().optional(), seconds: z.number().optional(), label: z.string().optional() },
    run: (s, a) => s.saveTimer(a),
  },
  {
    name: "update_timer",
    title: "Control a timer",
    description: "action: start (a saved timer) | pause | resume | restart (from full length) | add_minute | reset (saved timers go back to idle, others are removed) | stop (delete) | done.",
    input: { timer_id: z.string(), action: z.enum(["start", "pause", "resume", "restart", "add_minute", "reset", "stop", "done"]) },
    run: (s, a) => s.updateTimer(a),
  },
  {
    name: "stop_timers",
    title: "Stop all timers",
    description: "Stop every running or paused timer at once (saved timers go back to idle).",
    input: {},
    run: (s) => {
      const stopped = s.listTimers().filter((t) => t.state === "running" || t.state === "paused");
      for (const t of stopped) s.updateTimer({ timer_id: t.id, action: "reset" });
      return { stopped: stopped.map((t) => ({ id: t.id, label: t.label })) };
    },
  },
  {
    name: "set_alarms_enabled",
    title: "Turn alarms on or off",
    description: "Turn several alarms on or off at once: the listed alarm_ids, or all of them (all: true). Lecture alarms are included in all unless lectures: false.",
    input: { enabled: z.boolean(), alarm_ids: z.array(z.string()).optional(), all: z.boolean().optional(), lectures: z.boolean().optional() },
    run: (s, a) => {
      const pick = s.listAlarms().filter((x) => (a.all ? a.lectures !== false || !(x.lead_event_id || x.lead_course_id) : (a.alarm_ids ?? []).includes(x.id)));
      for (const x of pick) s.setAlarm({ alarm_id: x.id, enabled: a.enabled });
      return { changed: pick.map((x) => ({ id: x.id, label: x.label })), enabled: a.enabled };
    },
  },
  {
    name: "upcoming_events",
    title: "Upcoming events and birthdays",
    description: "The user's own events (birthdays, anniversaries, appointments, exams; not lectures) coming up in the next N days, soonest first, with days_until. birthdays: true for birthdays and anniversaries only.",
    input: { days: z.number().int().min(1).max(400).optional().describe("Default 60"), birthdays: z.boolean().optional() },
    readOnly: true,
    run: (s, a) => {
      const today = s.today();
      const days = a.days ?? 60;
      const dayMs = 86400000;
      const out = s.findEvents({ personal: true, limit: 500 }).events
        .filter((e) => e.next && (!a.birthdays || /birth|bday|b-day|anniv/i.test(e.title)))
        .map((e) => ({ ...e, days_until: Math.round((Date.parse(e.next.date) - Date.parse(today)) / dayMs) }))
        .filter((e) => e.days_until <= days)
        .sort((x, y) => x.days_until - y.days_until);
      return { today, events: out };
    },
  },
  {
    name: "add_birthday",
    title: "Add a birthday",
    description: "Add someone's birthday as one all-day event that repeats every year. date: YYYY-MM-DD (the birth date or any year) or MM-DD.",
    input: { name: z.string(), date: z.string().regex(/^(\d{4}-)?\d{2}-\d{2}$/) },
    run: (s, a) => {
      const today = s.today();
      let d = a.date.length === 5 ? `${today.slice(0, 4)}-${a.date}` : a.date;
      const name = a.name.trim().replace(/'s$/i, "");
      return s.addEvent({ title: `${name}'s birthday`, kind: "event", date: d, start: "00:00", end: "23:59", repeat: { freq: "yearly" } });
    },
  },
  {
    name: "get_settings",
    title: "Get settings",
    description: "The app's settings: time zone, 12/24-hour clock, week start (ISO weekday), alarm sound on/off, ringtone, lecture reminder minutes.",
    input: {},
    readOnly: true,
    run: (s) => s.settings(),
  },
  {
    name: "set_settings",
    title: "Change settings",
    description: "Change app settings on every device: time_format \"12h\" or \"24h\", week_start (ISO weekday: 6 Saturday, 7 Sunday, 1 Monday), sound (alarm sound on/off). Time zone: use set_home_zone. Lecture reminders: set_lecture_reminders.",
    input: { time_format: z.enum(["12h", "24h"]).optional(), week_start: z.union([z.literal(1), z.literal(6), z.literal(7)]).optional(), sound: z.boolean().optional() },
    run: (s, a) => (s.setSettings(a), s.settings()),
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

// Validate and run a tool with the zod schema, for REST callers.
export function runTool(service, name, args = {}) {
  const tool = toolByName.get(name);
  if (!tool) throw Object.assign(new Error(`unknown action: ${name}`), { status: 404 });
  const parsed = z.object(tool.input).safeParse(args ?? {});
  if (!parsed.success) throw Object.assign(new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")), { status: 400 });
  return tool.run(service, parsed.data);
}
