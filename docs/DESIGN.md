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
5. **Plain data.** Notes are Markdown. Schedules export as iCal.

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
A one-off or recurring block of time. Times are **local wall-clock** in the
user's zone, so "Tuesday 8 AM" stays 8 AM across daylight saving.

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

`days` uses ISO weekdays, 1 = Monday ... 7 = Sunday. `freq` is `daily` or
`weekly`. Exported to iCal as `RRULE` + `EXDATE`.

### note
| field | type | |
|---|---|---|
| course_id | id? | the folder. `null` = inbox |
| session_date | `YYYY-MM-DD`? | the lecture it was written for |
| event_id | id? | which event of the course (a course can have a lecture and a lab) |
| title | text | |
| body | text | Markdown |
| pinned | 0/1 | pinned notes show in every session of the course |

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
   The grace windows cover walking in early and writing up after.
3. **Next** = the first occurrence starting after now (looking 7 days ahead).
4. Notes surfaced for the active session, in order:
   today's notes for that course (`session_date` = today), pinned course notes,
   then the last session's notes ("last time").

## Sync

- Pull: `GET /api/sync?since=<rev>` returns every row with `rev > since`
  plus the new cursor.
- Push: `POST /api/sync` with rows changed locally. Server keeps the row with
  the newer `updated_at` (last write wins) and assigns a new `rev`.
- A note conflict (both sides changed the body since the last sync) keeps the
  loser as a new note titled "... (conflict copy)" rather than dropping text.

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

Auth: bearer token for the prototype. OAuth 2.1 (needed by ChatGPT and
Claude web connectors) comes with the droplet deploy.

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
5. **Note editor**: title plus Markdown body, autosaves, shows which session
   it belongs to.

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
