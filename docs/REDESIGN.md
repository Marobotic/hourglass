# Hourglass redesign (v0.3)

The one spec for the new Hourglass on desktop (Windows + Linux), Android and iOS. Every
platform draws the same screens, with the same tokens, sizes, words and motion. If a platform
can't do something exactly, it does the closest thing and the gap is written down here.

**Nothing is removed.** Every feature of the 0.2.31 app keeps working: each screen section
below lists the features it must keep. When in doubt, open the old file named there and port
every behaviour it has.

Reference look: `docs/redesign/mockup.html` (open it in Chrome). It is the source of truth for
spacing and colour; this file is the source of truth for behaviour.

---

## 1. What changes

| | 0.2 | 0.3 |
|---|---|---|
| Desktop stack | QML window + Node sidecar | **Tauri 2 (Rust) + HTML/JS** window + the same Node sidecar. One `desktop/` for Windows and Linux. QML is retired |
| Assistant | one page per platform, hand-built | **Metro's AI window** (claude-tabs 0.5.4, commit `69bed73`, `ui/`): the same transcript, tool rows, live status line, composer and model/effort/mode footer, on every platform |
| Shell | sidebar of 10 rows | grouped sidebar (desktop), 5 tabs + Ask (phones), a page header on every page |
| Motion | almost none | one motion set (§4) on every platform |
| Look | Marochy, a bit flat | Marochy, tighter: page headers, hero cards, quieter lists, live states that breathe |

The house look stays: **Marochy** (`Documents/GitHub/Marochy-Ecosystem-Theme`): square corners
(radius 0, menus 4), JetBrains Mono for UI, Noto Sans for prose, one accent: **production red
`#B14242`**. Hourglass is a production app: never purple.

---

## 2. Tokens

Same numbers on every platform (px on desktop = dp on Android = pt on iOS).

### Colour (dark is the default; light follows the same mixes)

| Token | Value | Use |
|---|---|---|
| `bg` | `#121212` (Linux: Omarchy `colors.toml` background) | window, page, field wells |
| `fg` | `#f5f5f5` | text, icons |
| `surface` | mix(bg, fg, 4.5 %) = `#1C1C1C` | sidebar, cards, sheets, composer |
| `surface2` | mix 8.5 % = `#252525` | hover, current nav, user bubble, toast |
| `surface3` | mix 12 % = `#2D2D2D` | meter tracks, inline code, stop button |
| `border` | mix 14 % = `#323232` | every 1 px line |
| `faint` | mix 36 % = `#646464` | placeholders, version, timestamps |
| `muted` | mix 58 % = `#969696` | secondary text, section headers, idle nav |
| `accent` | `#B14242` | primary fill, current page bar, live, focus, selection |
| `accentInk` | `#db8585` (dark) / `#B14242` (light) | accent-coloured **text** on dark (readable red) |
| `onAccent` | `#FFFFFF` | text on an accent fill |
| `gold` | `#F0BE66` | pinned, queued messages |
| `teal` | `#4A8B8B` | ok, synced, done tool rows |
| `orange` | `#D66E36` | warning, offline |
| course palette | `#B14242 #D66E36 #F0BE66 #4A8B8B #7E6BAF #5B8C4A #C2587E #8A8A8A` | course stripes |

Tints are a colour at an alpha, never a new hex: chip 16 %, danger button 14 % (24 % hover),
selected 20 %, live card wash 8 %.

### Type

| Token | Size / weight | Use |
|---|---|---|
| `caption` | 12 | chips (UPPERCASE, +0.8 tracking), version, timestamps, footer pickers |
| `label` | 13 | section headers (UPPERCASE 600, +1.4 tracking, muted), buttons |
| `body` | 14 | fields, lists, menus |
| `row` | 15 | nav items, card titles, chat text (prose 15/1.6 sans) |
| `title` | 17 600 | page header title, sheet title |
| `hero` | 28 700 | hero card title (Now) |
| `clock` | 56 700, tabular | the clock on Now (phones 48) |
| `big` | 64 700, tabular | a running timer |

Mono = JetBrainsMono Nerd Font (icons are its glyphs). Sans = Noto Sans, only for note bodies,
note previews and assistant replies. Every number that ticks uses tabular figures.

### Space and size

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40` only.

| | Desktop | Phone |
|---|---|---|
| page padding | 32 (40 ≥ 1280 wide) | 16 |
| block gap | 28 | 24 |
| content max width | 880 (Schedule, Drive and Assistant are full width) | — |
| page header | 56 tall, hairline under | 56 tall, hairline under |
| sidebar | 248 (64 under 980 wide) | — |
| tab bar | — | 64 + safe area, hairline over |
| button / compact | 34 / 28 | 44 / 36 (touch) |
| field | 36 | 44 |
| nav row | 36 | — |
| card stripe | 4 | 4 |
| sheet / confirm / menu | 560 / 420 / 240 wide | full width bottom sheet |

---

## 3. Shell

### Desktop

```
┌──────────────────────┬──────────────────────────────────────────────────────────┐
│ ⧗ Hourglass    0.3.0 │  Now                         Tue 6 Oct    [＋ Note] [⌘K] │ 56, hairline
│ [＋ New          ⌃N] │──────────────────────────────────────────────────────────│
│                      │                                                          │
│ TODAY                │   page content (view-in on every switch)                 │
│ ▌◷ Now            1  │                                                          │
│  ▦ Schedule       2  │                                                          │
│  ☑ Attendance     3  │                                                          │
│ WRITE                │                                                          │
│  ✎ Notes          4  │                                                          │
│  ▤ Drive          5  │                                                          │
│ TIME                 │                                                          │
│  ⏰ Alarms        6  │                                                          │
│  ⧖ Timers         7  │                                                          │
│  ◍ World clock    8  │                                                          │
│ ASK                  │                                                          │
│  ✦ Assistant      9  │                                                          │
│                      │                                                          │
│ ┌▌LIVE · ALGORITHMS┐ │                                                          │
│ │ 23 min left  ━━━ │ │                                                          │
│ └──────────────────┘ │                                    [ toast ]             │
│ ⚙ Settings        0  │                                                          │
│ ■ Synced · mi@…      │                                                          │
└──────────────────────┴──────────────────────────────────────────────────────────┘
```

- **Sidebar** `surface`, right hairline. Top: logo (pixel hourglass) + "Hourglass" 17/700 + version
  in faint, right-aligned. Under it a full-width primary **New** button: a menu with Note, Event,
  Course, Alarm, Timer (Ctrl+N opens it). Then nav groups with UPPERCASE `caption` group labels.
  Nav row 36: icon, label, the key hint in faint on the right (shown on hover/current only).
  Current row: `surface2` + a 3×18 accent bar on its left edge; the bar **slides** between rows
  (§4). A row with live news shows a count chip (Alarms ringing, Assistant working).
- Bottom of the sidebar: the **live mini card** (only while a session is on: course stripe, LIVE
  chip, title, time left with a 3 px progress line; click → Now), then Settings, then the sync
  line (`■` teal Synced / orange Offline / faint Local + the account email, ellipsised).
- Narrow (< 980): icons only, 64 wide, tooltips on hover; the New button becomes a 40 square `＋`.
- **Page header** (every page): title 17/600, a muted context line or controls in the middle
  (Schedule: ‹ Today › and Week/Day/Month; Notes: search; Drive: path), page actions on the
  right. Same header component on every page.
- **Command palette** Ctrl+K: jump to a page, a course, a note (search), or "Ask Hourglass: …"
  which opens the Assistant with that text sent.
- Keys: `1`–`9`, `0` pages; `n` note for the current session; Ctrl+N New; Ctrl+K palette;
  Esc closes the top overlay or leaves the editor. All keys of 0.2 keep working.
- Window: X hides to the tray (Show Hourglass / Quit Hourglass), single instance (a second launch
  shows the first window), the sidecar's `POST /api/window/show` still focuses it.
- Overlays: sheet (modal), confirm, context menu, toast, ring overlay, drop-to-upload tint,
  "Starting Hourglass…", sign-in. All in §5.

### Phones (Android and iOS, identical)

- **Page header** 56: page title 17/600 left (Now shows the logo + "Hourglass"), actions right:
  Settings `⚙` always; page actions before it (Notes: search, Schedule: today).
- **Tab bar** 64 + safe area, `surface`, hairline on top. Five tabs: **Now · Schedule · Notes ·
  Time · Ask**. Ask is the Assistant (it moves from a header icon into the tab bar). Drive moves
  under Notes as a segmented `Notes | Drive` at the top of that tab. Time = `Alarms | Timers |
  World clock` segmented (as today). Attendance opens from Schedule's header (`☑`) and from a
  course.
  Current tab: icon + label in fg, a 2×24 accent bar on top of the tab that slides between tabs;
  idle tabs muted. A count chip on Ask while it works, on Time while something rings.
- **Floating New** button: a 52 square accent button bottom-right above the tab bar on Now,
  Schedule and Notes; it opens the same New menu as desktop (as a bottom sheet).
- Sheets are bottom sheets (drag handle, swipe down to close); confirms are centred.
- Back: Android system back / iOS edge swipe close the top overlay, then the editor, then go to Now.

---

## 4. Motion

One set, taken from Metro's `ui/css/motion.css`. Off under reduce-motion (OS setting) and while
the window is hidden/minimised (desktop: `.motion-paused`). Nothing moves at rest except "live"
things.

| What | Duration | Easing | Detail |
|---|---|---|---|
| hover colour | 120 | ease `cubic-bezier(.2,0,0,1)` | colours only |
| press | 80 | ease | scale .975 (buttons, cards, tabs) |
| page / tab switch | 260 | ease | new page fades in from translateY 8; the old one is gone at once |
| list rows on first show | 220 | ease | rise 6, stagger 20 ms, at most the first 10 rows |
| nav / tab indicator | 240 | spring `cubic-bezier(.34,1.4,.64,1)` | the accent bar slides to the new row |
| sheet in / out | 220 / 120 | ease / ease-in | fade + translateY 14 + scale .985; phones slide up from the bottom |
| toast in / out | 220 / 160 | spring / ease-in | from translateY 12, scale .96; held 3.5 s |
| new chat row | 280 | spring | replies rise 10; the user's own message slides in from the right 18 |
| tool / thinking row | 220 | ease | fade up |
| live card | 2.4 s loop | ease-in-out | the LIVE stripe and chip **breathe** (accent wash 0 → 9 %) |
| progress / meters | 600 | ease | width eases |
| ring overlay | 160 in | ease | the logo shakes ±8° every 180 ms while ringing |
| number change | 160 | ease | a changing clock/timer digit rolls up (desktop CSS, Compose `AnimatedContent`, SwiftUI `.contentTransition(.numericText())`) |
| working spark | 1.2 s loop | linear | Metro's spark frames + shimmer on the status word (§6) |

Android: Compose `tween`/`spring` with the same numbers (`ui/Motion.kt` holds them). iOS:
`Animation.timingCurve` with the same curves (`Motion.swift`). Desktop: CSS variables
`--quick: 120ms; --ease; --spring; --t-press: 80ms; --t-exit: 120ms`.

---

## 5. Screens

Each screen lists **Keep** (the features from 0.2 that must survive; the old files are the
reference) and **New** (the redesign).

### Now
Old: `linux/app/Hourglass/NowPage.qml`, Android `ui/Screens.kt` (Now), iOS `Screens.swift`.
- **New:** date line (15 muted) over the clock (`clock` size, digits roll). Then the **hero card**:
  - Live: course stripe 4, a breathing wash, `LIVE · LECTURE` chip row, title `hero`, a line with
    `08:00 – 10:00 · Room 4.12 · Dr. Okafor`, time left on the right ("23 min left", accentInk),
    a 3 px progress line along the bottom. Buttons: **Notes for this class** (primary), Mark
    attendance (ghost), ⋯ (session menu: skip today, edit event, open course).
  - Nothing live: "Next" card with countdown ("in 1 h 20 min"), same layout without the wash.
  - Day off: one quiet line "Nothing else today" + tomorrow's first event; no empty hero.
- **Notes for this session**: a 2-column grid (1 on phones) of note cards (pin/gold, title 15/600,
  2 lines of sans preview, `Algorithms · Today`); a dashed "＋ New note" tile last.
- **Coming up**: today's remaining timeline as rows (time column 72 wide tabular, stripe dot,
  title, room).
- **Running timers and next alarm**: compact rows; a running timer shows its live countdown.
- **Keep:** active/next/day-off resolution from `whats_now`, surfaced notes order (today's,
  pinned, last time), one-tap create note for the session, open session dialog, mark attendance,
  timers/alarms summary, seconds only while something shows seconds.

### Schedule
Old: `SchedulePage.qml`, `SessionDialog.qml`, `EventDialog.qml`, `CourseDialog.qml`, Android
`ui/Schedule.kt`, iOS `Screens.swift`.
- **New:** header with ‹ Today ›, a segmented Day / Week / Month (desktop), Day / Week on phones.
  Week: seven columns, a time gutter, blocks in course colour (fill 20 %, 3 px left stripe in the
  full colour, title 13/600, time + room caption), the current time as a 1 px accent line with a
  dot, today's column header in accent. Hover lifts a block to 28 %; click opens the session
  sheet. Phones: a horizontal day strip (Mon…Sun, today underlined, swipe between days) over a
  day timeline.
- **Keep:** week/day/month, timezone conversion, recurrence and exceptions, skip occurrence vs
  series, add/edit/delete event and course (course colour picker, code, room, teacher, archive),
  session dialog (notes for that session, mark, skip), drag nothing new.

### Attendance
Old: `AttendancePage.qml`. Per course: a header with the rate (`attended / held`, a 4 px meter,
orange under 75 %), then sessions as rows with a 3-way segmented `Attended | Absent | Off`.
Keep everything it does.

### Notes
Old: `NotesPage.qml`, `NoteEditor.qml`, `RichNote.qml`, `NoteCard.qml`, `FolderRow.qml`,
Android `Notes.kt`, `NoteScreen.kt`, `NoteView.kt`, `RichNoteEditor.kt`, iOS `RichNote.swift`,
`NoteBody.swift`, `NoteText.swift`, `Versions.swift`.
- **New:** two panes on desktop ≥ 1100: left a 320 list (search field, folders = courses with
  their colour square and count, Inbox, Pinned, then notes by date), right the open note. Narrow
  and phones: list, then the note full screen.
  Note view: title 24/700, a meta line (course chip · session date · edited 5 min ago · versions),
  the body in sans 16/1.7 at max 720 wide. Opens formatted to read; Edit (Ctrl+E / double-click /
  phones: tap Edit) shows the formatting toolbar as a sticky bar under the header.
- **Keep:** Markdown + `<u>` + font/size spans (core/noteformat.js), tickable to-dos that save at
  once, renumbering lists, smart Enter/Tab, toolbar (bold, italic, underline, strike, heading,
  lists, to-do, image, file, font, size), autosave 600 ms, Ctrl+S, versions sheet + restore,
  conflict copies, pin, move to course, delete with confirm, images and file attachments,
  search, share (phones' share target keeps working).

### Drive
Old: `DrivePage.qml`, Android `Drive.kt`, iOS `Drive.swift`, `UploadPanel.swift`. Header: a
breadcrumb path, usage meter (`2.1 / 10 GB`), Upload, New folder. Grid/list toggle; rows with
file-type glyph, name, size, modified. Drop anywhere to upload (the accent tint overlay), upload
progress as rows in a bottom-right panel. **Keep:** folders, move, rename, delete, shares
(link create/revoke), folder sync, previews, sha256 checks, usage.

### Alarms · Timers · World clock
Old: `TimePage.qml`, `TimersPage.qml`, `WorldClockPage.qml`, `DayToggles.qml`, Android
`Screens.kt` (Time), `Reminders.kt`, iOS `Reminders.swift`, `Ring.swift`.
- **Alarms:** rows: time 28/700 tabular, label, `DayToggles` (7 squares 28), a switch; lead
  alarms ("15 min before Algorithms") show the course stripe. Add opens a sheet.
- **Timers:** quick chips (5 · 10 · 25 · 50 min · custom), each running timer a card with the
  `big` countdown (digits roll), a ring progress drawn as a square perimeter line (no circles),
  Pause/Resume, +1 min, Reset, delete.
- **World clock:** cities as rows: city, offset ("+7 h"), local time 28/700, a day/night glyph.
- **Keep:** everything: repeat days, one-off date, lead alarms per event/course, enable switch,
  snooze, ringtones, timers syncing across devices, timezone search, app timezone.

### Assistant
§6.

### Settings
Old: `SettingsPage.qml`, `AssistantSettings*.qml`, Android/iOS Settings. One column, max 720,
grouped sections with the section header style: Account (email, sign out with confirm), Sync
(state, Sync now, server), Appearance (theme follows Omarchy on Linux; dark/light on others),
Time zone, Alarms & ringtones (pick, preview, upload, test ring), Assistant (engine, keys,
Claude login, models, usage link), AI link (MCP/REST key for other AIs), About (version,
update). **Keep** every setting that exists today.

### Sign-in
Old: `LoginPage.qml`. Full window: logo at cell 6 with the sand trickling (a slow 3-frame pixel
animation), the wordmark, a 380 card with a `Sign in | Create account` segmented control,
fields, primary button, "Forgot password?". Keep login, register, forgot, errors.

### Overlays
- **Ring:** black 60 % scrim, a 400 card with a 2 px accent border, the shaking logo, `ALARM` /
  `TIME'S UP` in accentInk, the label, the clock 56/700, Snooze 5 min (ghost) and Dismiss
  (primary). Phones keep their full-screen ring activity/AlarmKit UI in the same style.
- **Toast:** one line, bottom centre (phones: above the tab bar), `surface2`, 1 px border with a
  3 px accent left edge, optional action ("Undo").
- **Starting:** `bg`, logo, "Starting Hourglass…" muted, a 3 px indeterminate line.

---

## 6. Assistant (Metro's AI window)

Port from Metro 0.5.4 (`claude-tabs` at commit `69bed73`, read it with
`git -C ../claude-tabs show 69bed73:ui/views/chat.js` etc., do not touch that repo). Desktop
reuses the code (copy the files into `desktop/ui/chat/` and adapt; keep Metro's names so later
fixes can be carried over). Phones rebuild the same layout natively. The server API is
`docs/ASSISTANT-API.md`; nothing changes server-side.

Assistant chats in Metro already use production red (`html[data-chat-role="assistant"]`), which is
exactly Hourglass's accent.

```
┌ header 56 ───────────────────────────────────────────────────────────────────────┐
│ ✦ Assistant   Anthropic · Haiku 5.5 · medium      12k tokens · 34% usage  [working]│
├──────────────────────────────────────────────────────────────────────────────────┤
│                                   ┌───────────────────────────────────────────┐   │
│                                   │ Wake me at 7:30 on weekdays          [img]│   │  user bubble
│                                   └───────────────────────────────────────────┘   │
│                                                      Queued · after this reply   │
│  ✓ Set an alarm  7:30 · Mon–Fri                                                   │  tool row
│  ● Read your schedule                                                             │
│     └ 3 events this week                                                          │  tool detail
│  ▸ Thought for 4 s                                                                │  thinking
│  Done: your alarm rings at 7:30 every weekday.  (prose, sans 15/1.6)              │
│  ┌ card: Alarm 07:30 · Mon–Fri [Open] ┐                                           │  result card
│  ⎘ Copy  ↻ Retry  ↶ Undo                                                          │  hover actions
│                                                                                    │
│  ✳ Simmering… 12 s · 1.2k tokens                                                  │  live status
│ ┌──────────────────────────────────────────────────────────────────────────────┐ │
│ │ ＋  Ask Hourglass…                                                      [ → ] │ │  composer
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│  Free · auto                                  Haiku 5.5 · Medium ⌄  │  Auto ⌄    │  footer
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Header** (Metro `chat-head`): engine glyph, "Assistant", second line = engine · model · effort
(always show the effort, never just the model), right side: token count · plan usage % (from
`/api/assistant/usage`, opens the usage sheet), a status chip (`idle` faint, `working` accent,
`error` red), and ⋯ (New chat, Assistant settings, Usage).

**Transcript** (Metro `msgs`, `rows()`): rows keyed by message id and only the changed rows
update (a streaming reply grows in place; selection, open details and scroll survive every
token). Only the newest ~60 rows are drawn; scrolling to the top shows more. Scroll: stick to the
bottom while at the bottom; a "↓ New messages" button otherwise.
- **User bubble** right, `surface2`, 1 px border, max 80 %, images as 60 px thumbs (lightbox on
  click). Hover: Edit, Copy. Queued/steering tag under it (Metro `qtag`: gold "Queued · after
  this reply" with a **Send now** button; accent "Steering · seen at the next step").
- **Tool row** (Metro `toolCall`): one mono 13 line, a status dot (● accent running, ✓ teal done,
  ✕ red failed), a human verb ("Set an alarm", "Read your notes") + a short summary, click to
  expand the detail (args/result, Hourglass's existing tool detail). Never echo the user's text.
- **Thinking**: "▸ Thought for 4 s", expands to the text.
- **Reply**: Markdown via Metro `md.js` (headings, lists with digit-aware padding, tables in a
  scroll wrap, code blocks with Copy, quotes, images with lightbox, links). Hourglass result
  **cards** (alarm, event, note, timer, file: `server/cards.js`) render as compact Marochy cards
  with an Open action. Pending actions (dangerous ones) render as an ask card with
  Approve / Decline (Metro `asks.js` look).
- Hover actions under a reply: Copy, Quote (into composer), Retry, Undo (when the turn changed
  data). Errors: Metro `msgerr` box, with "Resets at 14:00" for limit errors and Retry.
- **Empty state**: the logo, "Ask Hourglass to do it for you", one muted line, then the
  suggestion chips as a 2-column grid of ghost buttons (1 column on phones).

**Live status line** (Metro `statusLine`, `status-words.js`, the spark in `motion.css`): just
above the composer while a turn runs: the spark, one word picked per turn ("Simmering…",
"Writing…" only while text streams, the tool verb while a tool runs), elapsed time, tokens.

**Composer** (Metro `composer`, `composer-extras.js`, `attachments.mjs`, `drafts.mjs`,
`clipboard.js`): a `surface` box with a 1 px border (faint on focus, accent while dragging a
file over), `＋` attach (files, Drive, pasted images), the textarea (grows to 180, Enter sends,
Shift+Enter new line, ↑ in an empty box edits the last message), attachment chips above the text,
and a 42 square send button that becomes **Stop** (surface3) while working. Typing while it works
queues; the queued message shows its tag. Drafts persist per chat.

**Footer** (Metro `modelEffortPicker`, `permissionsPicker`): left a faint line (engine · account);
right **Model · Effort ⌄** (a menu: models from `/api/assistant/models` grouped by engine, effort
levels the model supports) and **Mode ⌄** (Auto / Plan, `/api/assistant/mode`).

**Keep** (from `AssistantPage.qml`, `AssistantSettings.qml`, `AssistantUsage.qml`,
`AssistantStream.qml`, `ResultCard.qml`, `ToolRow.qml`, `StepList.qml`, `ChatMarkdown.*`,
`ChatLightbox.qml`, Android `AssistantScreen.kt`, `AssistantParts.kt`, `AssistantCards.kt`,
`AssistantSettings.kt`, `core/ChatStream.kt`, iOS `Assistant.swift`, `AssistantCards.swift`,
`AssistantStream.swift`, `AssistantSettings.swift`, `AssistantUsage.swift`): live stream with
snapshot fallback, model + effort, queue and steer, retry / edit / undo, tool detail, steps,
plan mode, usage, attachments, Drive folder pick, pasted images, lightbox, copy / quote, code
copy, tables, drafts, suggestion chips, Claude login, engine/API key settings, quota and limit
errors, sync after a turn (`/api/sync/now`).

---

## 7. Desktop app layout

```
desktop/
  src-tauri/            Cargo.toml, tauri.conf.json, src/main.rs (tray, single instance, close to tray,
                        sidecar check/start, token command), icons/
  ui/
    index.html
    app.js              boot, router, keys, palette, overlays
    api.js              port of Api.qml (same read-only action list, revision + changed event)
    dom.js              Metro's h() helper and friends
    kit/                button, field, picker, segmented, switch, day-toggles, card, chip, section,
                        sheet, confirm, menu, toast, tip, meter, icon (Nerd Font glyph map from Icon.qml)
    pages/              now.js schedule.js attendance.js notes.js note-editor.js drive.js alarms.js
                        timers.js world.js assistant.js settings.js login.js
    chat/               Metro's chat files, adapted
    css/                tokens.css kit.css motion.css shell.css pages/*.css chat.css composer.css
    fonts/              JetBrainsMono Nerd Font, Noto Sans (woff2)
    dev/fake-sidecar.mjs  serves fixture data on 8931 so ui/ can be screenshotted in plain Chrome
  build.mjs             esbuild bundle to dist/
```

- No framework, no Python. Vanilla ES modules bundled by esbuild, as Metro does.
- Page module contract: `export function mount(root, ctx)` returns `{ update(changed), unmount() }`.
  `ctx` holds `api`, `state` (now, app, courses, settings), `ui` (toast, sheet, confirm, menu),
  `go(page, arg)`.
- The window talks to the sidecar on `127.0.0.1:8931` with the bearer token. The token comes from
  a Tauri command reading the sidecar's token file (`%APPDATA%\Hourglass\token`,
  `~/.config/hourglass/token`); the sidecar answers CORS for the Tauri origin.
- On start, if the sidecar doesn't answer, the app starts it (`node hourglassd.js` from the
  install folder) and shows "Starting Hourglass…". The sidecar's `openWindow()` launches the
  Tauri exe instead of `qml.exe`.
- Builds and tests happen only on the laptop (`marolaptop`), never on the PC.

---

## 8. Done means

- Every **Keep** list above works on its platform.
- Desktop, Android and iOS screenshots of Now, Schedule, Notes, a note, Time, Assistant (empty,
  streaming, tools) and Settings side by side look like one product.
- No radius other than 0 (menus 4), no colour outside §2, no purple.
- Reduce-motion turns every animation off.

---

## 9. As built (0.3.0)

Where the build differs from the plan above, on purpose:

- **Keys stay the 0.2 ones** (Now 1, Schedule 2, Notes 3, Alarms 4, Timers 5, World clock 6, Attendance 7,
  Drive 8, Assistant 9, Settings 0; a, r, t, w; n), so nobody's habits break. The sidebar groups the pages; the
  key hint shows on hover.
- **Reminders** is its own page under TIME (it existed on Windows in 0.2 and was missing from the plan).
- **Notes** is course folders on the left and the masonry grid on the right; a note opens full width with Back.
- **The note editor is a word processor** (what you see is the note), as the Qt one was: no separate edit mode.
- **Linux** keeps the Qt window until the Tauri one is built on a Linux machine: `linux/install.sh` builds it when
  Rust and Node are there, and `linux/bin/hourglass` opens it when it exists. `windows/app` is gone.
- **Dev screenshots**: `desktop/ui/dev/serve.mjs --shot out.png --page now,schedule` runs the real service with the
  demo week and renders pages in headless Edge (`?open=note|event|session`, `?fakechat` for the assistant).
