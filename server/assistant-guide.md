# Hourglass, the app

Hourglass is one app on Windows, Linux, Android and iPhone: calendar, notes,
alarms, timers, world clock, attendance and a Drive, built around one idea:
the right notes at the right moment. Everything syncs through the user's
account (the same sign-in as the Jukebox music app). It works offline and
syncs when it can; alarms ring from the device itself.

## Screens

Desktop (sidebar, keys 1-0): Now, Schedule, Notes, Alarms, Timers, World
clock, Attendance, Drive, Assistant, Settings.
Phone (bottom tabs): Now, Schedule (Week and Attendance), Notes, Drive, Time
(alarms, timers, world clock). The Assistant and Settings are the two icons
at the top right.

- **Now**: what is on right now (a big card with the time left), what is
  next, and the notes for that session: today's note opens with one tap or is
  made with one tap. With nothing on, the next event and a countdown. Below:
  the rest of today, running timers and the next alarm.
- **Schedule**: the week, coloured by course. Click an empty slot to add an
  event, a block to open that session (mark attended/absent/off, skip it,
  edit or delete it: "this session" or "the whole series").
- **Notes**: notes grouped by course (a course is a folder; "Inbox" holds
  notes with none). A note belongs to a course and a day (the session it was
  written for). Pinned notes show in every session of their course.
- **The note editor** works like a word processor: select text, then Bold,
  Italic, Underline, Strike, Heading, bullet / numbered / to-do lists, a font
  (Inter, Lora, JetBrains Mono, Caveat, Playfair Display) and a size. To-dos
  tick right in the note. Pictures and files attach (they go to the Drive and
  show inside the note). It saves by itself. "Versions" lists older text of
  the note; clicking one restores it.
- **Alarms**: at a time (once, every day, on chosen days, or on a date), or N
  minutes before every session of a course ("lecture reminders" in Settings
  adds one for every lecture). Ringtones: six built in, an uploaded audio
  file, or a song from Jukebox ("Set as alarm" there). Settings has "Test
  alarm" to hear and see a real alarm right away.
- **Timers**: quick chips (5, 10, 25, 50 min), custom timers, saved timers
  that can be started again, timers scheduled to start later. They ring on
  every device.
- **World clock**: cities with their time and the difference from home. The
  home clock is the app's time zone on every device.
- **Attendance**: every course and every session so far: attended, absent,
  off (no class), or not marked. Click a box to change it.
- **Drive**: the user's files on the server, in folders that can hold
  folders. Every course has its own folder too. Upload with the button or by
  dropping files on the page (desktop). Drag a file or folder onto a folder
  to move it there (on phones: hold it, then drag; or "Move to…" in its
  menu). Pictures and videos preview; anything else opens in its own app
  (desktop: edits saved there upload again by themselves). "Download…" saves
  a copy. "Share…" makes a link: "anyone with the link can view" or "can view
  and download", optionally ending after 1, 7 or 30 days, at
  marobotic.dev/hourglass/drive/…; "Stop sharing" turns the link off. On a
  phone, Share also sends the file itself to another app (Messages, Mail,
  WhatsApp…). One upload can be up to 1 GB.
- **Assistant**: this chat. The user can attach pictures and files (the
  paperclip): they are saved in the Drive's "Assistant" folder.
- **Settings**: 12/24-hour time, week start, time zone, lecture reminders,
  ringtone, alarm sound on/off, Test alarm, "Use with AI" (a private link
  that lets ChatGPT, Claude, Gemini or any MCP client use Hourglass), the
  account (sign in, sync now, sign out), and updates (Windows and Android
  update themselves from marobotic.dev/apps/hourglass; iPhone installs come
  through SideStore).

## How-to answers (when the user asks how to do something in the app)

- Share a file: Drive > the file's ⋯ menu > Share… (link) — on a phone the
  same menu has "Send file" to send the file itself.
- Move things: drag onto a folder, or ⋯ > Move to….
- Change a note's font or size: select the text, then pick the font and size
  in the toolbar above the note.
- Hear the alarm sound: Settings > Alarms > Test alarm.
- Use Hourglass from ChatGPT or Claude: Settings > Use with AI > Make a link,
  then add it as a connector (MCP server).
