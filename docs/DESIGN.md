# Hourglass design

Calendar, notes, alarms and timers in one app, built around one idea:
**the right notes at the right moment.** When a lecture is on, its notes are
already open.

## Principles

1. **Now first.** The home screen answers "what is on right now, what is next,
   and what did I write for it". Everything else is one tap away.
2. **Courses are folders.** A recurring event belongs to a course; notes live
   in the course and are stamped with the session (the date of that lecture).
3. **Offline always works.** Every client keeps a full local copy and syncs
   when it can. Alarms ring from the device, never from the network.
4. **Every AI is a client.** The server exposes the same operations over REST
   (apps, Custom GPT actions) and MCP (ChatGPT, Claude, Gemini, CLIs).
5. **Plain data.** Notes are Markdown (plus `<u>` and a `<span style>` for
   fonts and sizes, see core/noteformat.js). Schedules export as iCal.

## Platforms

| Part | Stack | Notes |
|---|---|---|
| `core/` | JavaScript, no deps | Recurrence, "now" resolution, validation. Shared by server and Linux |
| `server/` | Node 22+, `node:sqlite`, MCP SDK | Source of truth, sync, REST, MCP, iCal |
| `linux/` | QML window + Node sidecar | Sidecar holds the local replica, fires alarms, syncs |
| `android/` | Kotlin, Jetpack Compose | AlarmManager exact alarms, full-screen alarm UI |
| `ios/` | SwiftUI, XcodeGen, built on GitHub Actions | AlarmKit, App Intents |
| `skill/` | `SKILL.md` | Teaches any agent the model and the tools |

Kotlin and Swift re-implement the small `core/` rules; `core/test` is the
spec they must match.

## Data model

Every row has `id` (UUID string), `updated_at` (ms epoch, set by the writer),
`deleted` (0/1 tombstone). The server adds `rev` (global sequence) for sync.

### course
| field | type | |
|---|---|---|
| name | text | "Algorithms" |
| code | text? | "CS201" |
| color | text | `#B14242`, from the palette |
| location | text? | default room |
| teacher | text? | |
| archived | 0/1 | |

### event
A one-off or recurring block of time. Times are **wall-clock in the event's
own zone** (`tz`), so "Tuesday 8 AM Cairo" stays 8 AM in Cairo across
daylight saving, and shows converted (1 AM) when the app is set to New York.
New events take the app's zone; `tz` null (older rows) floats with the app.

| field | type | |
|---|---|---|
| course_id | id? | lectures belong to a course, personal events do not |
| title | text | defaults to the course name in the UI |
| kind | text | `lecture` `lab` `tutorial` `exam` `event` |
| location | text? | overrides the course's |
| start_date | `YYYY-MM-DD` | first occurrence |
| start_time | `HH:MM` | |
| end_time | `HH:MM` | same day |
| repeat | json? | `null` = once. `{ "freq": "weekly", "interval": 1, "days": [2], "until": "2026-12-12" }` |
| exceptions | json | dates skipped: `["2026-10-27"]` |
| tz | text? | IANA zone the times are in, e.g. `Africa/Cairo` |

Occurrences carry `date`/`start_time`/`end_time` in the shown zone and
`session_date` in the event's own: notes, marks and skips use `session_date`.

`days` uses ISO weekdays, 1 = Monday ... 7 = Sunday (weekly only). `freq` is
`daily`, `weekly`, `monthly` or `yearly`; monthly and yearly repeat on the start
date's day of the month, and skip months that don't have it (the 31st, 29 Feb),
as iCal does. No `until` = forever. Exported to iCal as `RRULE` + `EXDATE`.

### note
| field | type | |
|---|---|---|
| course_id | id? | the folder. `null` = inbox |
| session_date | `YYYY-MM-DD`? | the lecture it was written for |
| event_id | id? | which event of the course (a course can have a lecture and a lab) |
| title | text | |
| body | text | Markdown, one line per line; fonts and sizes as `<span style="font-family: Lora; font-size: 20px">` (core/noteformat.js) |
| pinned | 0/1 | pinned notes show in every session of the course |

Editing a note never copies it. The server keeps older text in
`note_versions` (note_id, title, body, saved_at, reason): the text before an
editing session (at most one per 10 minutes), text that lost when two devices
edited at once (`conflict`), and text replaced by a restore. 40 per note.

### mark
One day of a course: `attended`, `absent` or `off` (no class: left out of
Now). id = `<course_id or event_id>:<session date>`, the same on every device.

### alarm
| field | type | |
|---|---|---|
| label | text | |
| time | `HH:MM`? | fixed-time alarm |
| days | json | ISO weekdays; empty = once |
| date | `YYYY-MM-DD`? | for a one-off alarm |
| lead_event_id | id? | "ring N minutes before every occurrence of this event" |
| lead_course_id | id? | "ring N minutes before every session of this course" |
| lead_minutes | int? | |
| enabled | 0/1 | |

### timer
| field | type | |
|---|---|---|
| label | text | |
| duration_s | int | |
| state | text | `running` `paused` `done` |
| ends_at | ms? | when running |
| remaining_s | int? | when paused |

Timers sync, so "start a 25 minute timer" from an AI rings on your devices.

## "Now" resolution (core/now.js)

1. Expand every event into occurrences for the day.
2. **Active session** = the occurrence where `start - 10 min <= now < end + 15 min`.
   The grace windows cover walking in early and writing up after. Sessions
   marked `off` are skipped.
3. **Next** = the first occurrence starting after now, today or within 12
   hours. Nothing later: with nothing on, Now says the day is off.
4. Notes surfaced for the active session, in order:
   today's notes for that course (`session_date` = today), pinned course notes,
   then the last session's notes ("last time").

## Sync

- Pull: `GET /api/sync?since=<rev>` returns every row with `rev > since`
  plus the new cursor.
- Push: `POST /api/sync` with rows changed locally. Server keeps the row with
  the newer `updated_at` (last write wins) and assigns a new `rev`.
- A note conflict (both sides changed the body since the last sync): the
  newer edit wins and the other text is kept as a version of the same note.
  Never a second note.

## AI surface

The same service functions back REST and MCP tools:

| Tool | Does |
|---|---|
| `whats_now` | active session, next event, today's timeline, surfaced notes |
| `get_schedule` | occurrences between two dates |
| `add_course` / `update_course` / `list_courses` | |
| `add_event` / `update_event` / `remove_event` | `remove_event` takes `scope: "occurrence" \| "series"` and a date |
| `get_notes` | by course and/or session date, or the last N |
| `add_note` / `append_note` / `update_note` / `delete_note` | |
| `search_notes` | full text |
| `set_alarm` / `remove_alarm` / `list_alarms` | including "N min before event" |
| `start_timer` / `stop_timer` / `list_timers` | |
| `search` | one search: calendar first, then notes, Drive, alarms |
| `list_drive` / `add_folder` / `move_folder` / `move_file` / `remove_folder` | folders nest; a folder never goes into itself |

The in-app assistant answers common requests itself (server/quick.js:
alarms, timers, birthdays, today) in well under a second; everything else
goes to opencode with the app guide (server/assistant-guide.md) and a
snapshot of the account in the prompt.

### Drive links

`POST /api/shares {file_id | folder_id, access: view | download,
expires_days}` makes (or changes) the one link of a file or folder;
`DELETE /api/shares/<token>` stops it. Anyone can open
`<server>/drive/<token>` with no sign-in: a page showing the file (or the
folder and what is under it). Links live in the account's `shares.json`, not
in the synced tables.

Auth: the account session, or a personal AI key (`GET/POST /api/ai`). The key
also works in the URL, `/mcp/<key>`, for ChatGPT and Claude connectors that
only take a link.

## UX

### Screens (all platforms)

1. **Now**
   - Big card for the active session: course colour bar, title, room,
     time left as a progress line.
   - Under it, the surfaced notes: today's note opens with one tap, or is
     created with one tap if it does not exist yet.
   - With nothing on, the card shows the next event and a countdown.
   - Below the card: the rest of today as a compact timeline, then running
     timers and the next alarm.
2. **Week**: seven columns (a day list on phones), blocks coloured by
   course, tapping a block opens that session.
3. **Courses**: course list with next session and note count.
   - A course page shows its schedule, then its notes grouped by session
     date, newest first.
4. **Timers & alarms**: quick timer chips (5, 10, 25, 50 min), running
   timers with big countdowns, alarms with day toggles.
5. **Note editor**: a word processor, no Markdown on screen: select text for
   bold, italic, underline, strike, headings, lists, to-dos (tick with a
   click), five fonts (Inter, Lora, JetBrains Mono, Caveat, Playfair Display)
   and sizes; pictures in place. Autosaves, shows which session it belongs to.

### Interaction rules

- Creating a note from the Now card pre-fills course, event, session date
  and a title like "Tue 30 Sep".
- Deleting a recurring event asks "this session / whole series".
- Nothing blocks on the network. Sync state is a small dot, not a spinner.
- Keyboard first on Linux: `n` new note, `t` timer, `1`-`4` switch screens,
  `/` search, `Esc` back.

### Look

- Linux follows the active Omarchy theme (`colors.toml`), so the app
  re-colours with the desktop.
- Mobile uses the Hourglass palette taken from the dotrb theme, dark by
  default: background `#121212`, surface `#1b1b1b`, text `#f5f5f5`, accent
  `#B14242`, plus `#D66E36`, `#F0BE66` and `#4A8B8B` for course colours.
- Square-ish cards, 1 px borders, the pixel hourglass mark.
