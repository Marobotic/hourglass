---
name: hourglass
description: The user's calendar, lecture notes, alarms and timers (Hourglass). Use whenever the user asks what is on now, today, next or this week; wants to add, move, skip or remove a lecture or event, or adjust their schedule; marks a class attended, absent or off; asks for, writes, appends to or searches their notes (especially "notes for this lecture" or "last week's notes"); or wants an alarm or timer. Works through the hourglass MCP tools, or the `hourglass-cli` shell command where MCP is not available.
---

# Hourglass

Hourglass is the user's own calendar and notes app, built around one idea: the
right notes at the right moment. During a lecture, its notes are what matter.

## The model

- **Course**: a folder, usually a university module ("Algorithms", code
  "CS201"), with a colour, default room and lecturer.
- **Event**: a one-off or recurring block of time. Lectures, labs, tutorials
  and exams belong to a course. Personal events have no course.
  Recurrence is `{ freq: "weekly", days: [2], until: "2026-12-11" }` with ISO
  weekdays (1 = Monday); `freq` can also be `daily`, `monthly` or `yearly`, and
  no `until` means forever. A birthday is ONE event with `{ freq: "yearly" }`,
  never one event per year. Skipped dates live in `exceptions`.
- **Note**: Markdown, in a course, stamped with `session_date`, the date of
  the lecture it was written for. Pinned notes show in every session. The
  server keeps older text as versions (`note_versions`, `restore_note_version`).
- **Drive**: the user's files on the server, in folders that nest
  (`list_drive`, `add_folder`, `move_folder`, `move_file`, `remove_folder`).
  A note shows a Drive picture with `![name](hgfile:<file id>)` and a file
  with `[name](hgfile:<file id>)` on a line of its own.
- **Note text**: Markdown, one line per line (a line break is a line break).
  `**bold**`, `*italic*`, `~~strike~~`, `<u>underline</u>`, `# heading`
  (1-3 #), `- bullets`, `1. numbered`, to-dos as `- [ ] item` (ticked:
  `- [x] item`), and fonts and sizes as
  `<span style="font-family: Lora; font-size: 20px">text</span>` (fonts:
  Inter (default), Lora, JetBrains Mono, Caveat, Playfair Display; default
  size 15px). The apps edit notes like a word processor and write this back.
  When you rewrite a note, keep every span and tag the user had.
- **Mark**: one day of a course marked `attended`, `absent` or `off` (no class
  that day; it is left out of Now).
- **Alarm**: at a time (daily, on weekdays, or on one date), or N minutes
  before every session of a course.
- **Timer**: a countdown that rings on the user's computer and phone.

Times in results are shown in the app's zone (`now.tz` in `whats_now`). Each
event also has its own zone (`tz`, shown as `event_tz` on occurrences): its
start and end are fixed there, so an 08:00 Cairo lecture stays 08:00 Cairo
time and shows as 01:00 when the app is set to New York. Pass times in the
event's own zone when you change it.

## How to act

1. **Start with `whats_now`** for anything about now, today or next. It
   only looks at today and the next 12 hours: `next` is null (and `day_off`
   true) when nothing is on. Use `get_schedule` for anything further ahead.
   It returns the active session (live, or within 10 min before / 15 min after),
   the notes for it (`notes.session`, `notes.pinned`, `notes.last` with
   `notes.last_date`), today's timeline, timers and upcoming alarms.
2. **Refer to courses by name.** Tools take names, codes or partial names
   ("algo") and say clearly when a name is ambiguous or unknown.
3. **Adding a whole timetable**: one `add_course` per module with its
   `schedule` array and `term_end`, rather than many `add_event` calls.
4. **Notes during a lecture**: `add_note` with just the course attaches the
   note to today's session automatically. To add to an existing note, use
   `append_note` so nothing is overwritten.
5. **Skipping one lecture** (holiday, cancelled class): `remove_event` with
   `scope: "occurrence"` and the `date`. Only use `scope: "series"` when the
   user wants the whole recurring event gone.
6. **Confirm before destroying**: ask before `remove_event` series,
   `remove_course` or `delete_note`.
7. **Finding something by name** (a person, a birthday, a file): `search`
   looks in the calendar first, then notes, Drive and alarms, in one call.
8. **Answering from notes**: read with `get_notes` (full bodies) or
   `search_notes` (snippets), then answer in your own words and say which
   note and session the answer came from.

## Examples

| User says | Do |
|---|---|
| "What's on now?" / "What's next?" | `whats_now` |
| "Show my notes for this lecture" | `whats_now`, then present `notes.session`, `notes.pinned`, `notes.last` |
| "I have Algorithms every Tuesday 8-10 in Room 4.12 until December 11" | `add_course {name, location, schedule:[{day:"Tue",start:"08:00",end:"10:00"}], term_end:"2026-12-11"}` |
| "No lecture next Tuesday" | `list_courses` to find the event id, then `remove_event {scope:"occurrence", date}` |
| "Move my Thursday lab to 15:00" | `update_event {event_id, start:"15:00", end:"16:00"}` |
| "Add to today's notes: Dijkstra fails with negative weights" | `whats_now`; if a session note exists `append_note`, else `add_note {course}` |
| "What did we cover in Linear Algebra last week?" | `get_notes {course:"Linear Algebra"}` and summarise the latest session |
| "Wake me at 7:15 on weekdays" | `set_alarm {time:"07:15", days:["Mon","Tue","Wed","Thu","Fri"], label:"Wake up"}` |
| "Remind me 15 minutes before every OS lecture" | `set_alarm {before:"Operating Systems", minutes_before:15}` |
| "25 minute timer" | `start_timer {minutes:25}` |
| "I skipped Typography today" / "No class Saturday" | `mark_session {course:"Typography", status:"absent"}` / `mark_session {course, date, status:"off"}` |
| "How many Printmaking classes have I missed?" | `get_attendance {course:"Printmaking"}` |
| "What's in my Drive?" / "Make a folder for Typography" | `list_drive` / `add_folder {name:"Typography"}` |
| "Put the Labs folder inside Typography" | `list_drive` for both ids, then `move_folder {folder_id, parent_id}` |
| "When is Sara's birthday?" | `search {query:"sara birthday"}` (the calendar comes first) |
| "Undo the change to my note" | `note_versions {note_id}`, then `restore_note_version {version_id}` |

## Connecting an AI

Any AI that speaks MCP can use Hourglass. In the app: Settings > Use with AI >
Make my AI link. That gives a personal link like
`https://marobotic.dev/hourglass/mcp/hg_...`:

- **ChatGPT** (Settings > Connectors, developer mode) and **Claude**
  (Settings > Connectors > Add custom connector): paste the link, no auth.
- **Claude Code**: `claude mcp add --transport http hourglass <link>`
- **Gemini CLI** (`~/.gemini/settings.json`) and **Codex**
  (`~/.codex/config.toml`): an MCP server entry with `httpUrl`/`url` = the link.
- **Custom GPT actions**: import `https://marobotic.dev/hourglass/openapi.json`
  and use the key (the part after `/mcp/`) as a Bearer API key.

Then just say "use Hourglass to move my Tuesday lecture to 10". New link in
Settings turns the old one off.

## Without MCP

```bash
hourglass-cli now                                   # same as whats_now
hourglass-cli actions                               # every action with its JSON schema
hourglass-cli add_note '{"course":"Algorithms","body":"..."}'
hourglass-cli remove_event '{"event_id":"...","scope":"occurrence","date":"2026-10-06"}'
```

Output is JSON. Errors come back as `{"error": "..."}` with a readable message.
