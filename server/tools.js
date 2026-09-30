// The single list of operations exposed to AIs. MCP registers each one as a
// tool; REST serves the same list at POST /api/actions/<name>.
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");
const time = z.string().regex(/^\d{1,2}:\d{2}$/).describe("24h HH:MM, the user's local time");
const weekday = z.union([z.string(), z.number()]).describe('Weekday: "Mon".."Sun", full name, or ISO number 1=Mon..7=Sun');
const course = z.string().describe("Course name, code or id. Partial names work when unambiguous");
const repeat = z
  .object({
    freq: z.enum(["daily", "weekly"]),
    days: z.array(weekday).optional().describe("For weekly; defaults to the start date's weekday"),
    interval: z.number().int().min(1).optional().describe("2 = every other week/day"),
    until: date.optional().describe("Last date, inclusive (e.g. end of term)"),
  })
  .describe("Omit for a one-off event");

export const INSTRUCTIONS = `Hourglass is the user's calendar, notes, alarms and timers.
Model: courses are folders (e.g. a university module). Events are one-off or recurring blocks of time, usually lectures of a course. Notes are Markdown, live in a course, and are stamped with a session_date: the date of the lecture they were written for.
Start with whats_now for anything about "now", "today" or "next". All times are the user's local wall-clock time (see now.tz in whats_now).
When removing a single lecture of a recurring series use remove_event with scope "occurrence" and the date; only use scope "series" when the user wants the whole thing gone.
Confirm destructive actions (remove_event series, remove_course, delete_note) with the user first.`;

export const TOOLS = [
  {
    name: "whats_now",
    title: "What's on now",
    description: "The current session (with its notes: this session's, pinned, and last session's), the next event, today's timeline, running timers and next alarms.",
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
    description: "Alarm sounds: the built-in ones plus uploads and songs from Omarchy Music. selected marks the one alarms ring with on every device.",
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
