// The motion strips and the comparison sheets (current app next to round 5).
export const MOTIONS = ['screen', 'tabs', 'todo', 'att', 'live', 'timer', 'ring'].map((id) => ({ id }));

const SNAP = (n) => `../../../android/app/src/test/snapshots/images/dev.marobotic.hourglass.ui_Shots_${n}.png`;
// Crops of docs/redesign/mockup.png (the 0.3 spec, 1540 x 3000), in its own pixels.
const CROP = { now: [39, 87, 1442, 900, 'Desktop Now'], assistant: [39, 1083, 1442, 900, 'Desktop Assistant'] };
const INFO = {
  now: { title: 'Now', snap: 'now', crop: 'now', better: [
    'The live class is one card with a real progress bar (start, now, end), the minutes left and one-tap Mark attended.',
    'Notes for this class sit inside that card, with full titles; no 2-line squeezed tiles.',
    'Running timer (draining ring) and next alarm are side by side, then the rest of today as a timeline with the next class counting down.',
    'PC adds a whole-day strip with the now line, Coming up (quiz, deadline, inbox) and term attendance against the 75% line.',
    'Type scale: a confident 60 to 120 px clock, 30 to 44 px class name, 12 px uppercase section labels; strict 4/8 spacing.'] },
  schedule: { title: 'Schedule · Week', snap: 'week', better: [
    'Same structure as today: Week and Attendance tabs, the week range with arrows, Week / Month and Today, sessions listed by day.',
    'Today gets a now line through the live session (09:37) and a red-tinted live card with the minutes left in the corner.',
    'Past days fold into one line (Both attended · 2 sessions) so today is at the top without scrolling.',
    'Cards keep start over end time on the left, course colour edge, room on the right; nothing truncated.',
    'PC: the seven days as columns of the same cards, today highlighted, plus the selected session (room, lecturer, alarm, attendance, notes).'] },
  attendance: { title: 'Attendance', snap: null, better: [
    'Same structure: a tab of Schedule, one card per course with its percentage, the counts and a box per session; Attended / Absent / Off.',
    'A term summary up top: 87%, a stacked bar and a legend, so the whole term reads at a glance.',
    'Today’s unmarked session is outlined in red with the three-way toggle right under it.',
    'Below 75% the card warns in plain words: what one more absence does, and how many sessions are left.',
    'PC adds the to-mark list and a week-by-week term heat map per course.'] },
  notes: { title: 'Notes', snap: 'notes', better: [
    'Full-width cards: titles never truncate (the current phone cuts “Dynamic programmi…”), previews in Noto Sans, two lines.',
    'Course filter chips replace the dropdown; the composer stays one tap away.',
    'Sections that think: notes for the class that is live now, then pinned, then recent.',
    'Checklists preview with the real 0.3.4 boxes and a done count.',
    'PC: course rail with counts, four-column grid, the live class band first.'] },
  note: { title: 'Note with a checklist', snap: 'noteChecklist', better: [
    'The 0.3.4 to-do box exactly: 5 px corners, muted ring, red flood, drawn tick; wrapped text lines up after the box, never under it.',
    'Header shows the course and session (Tue 6 Oct · Lecture 08:00 · live) and a progress bar for the checklist.',
    'Noto Sans at 16/26 for the writing, JetBrains Mono for the chrome; headings, highlight and bullets with a red marker.',
    'Formatting bar sits at the bottom within thumb reach instead of a crowded top row.',
    'PC: the class’s notes on the left, the page centred at 760 px, live class, checklist, versions and attachments on the right.'] },
  alarms: { title: 'Alarms', snap: 'time', better: [
    'A Next ring hero (10:30, in 53 min, then 07:15 Wed) so the question “when does it ring” is answered first.',
    'Skip once is a first-class state: gold edge, the skipped ring struck through, when it rings again, and Undo skip.',
    'Every alarm shows its days as a strip and its next ring; lecture alarms say which course.',
    'Square switch with a red glow when on; off alarms fade.',
    'PC adds the next 48 hours as a timeline, which devices it rings on (synced), and the ringtone.'] },
  assistant: { title: 'Assistant · working', snap: 'assistantStreaming', crop: 'assistant', better: [
    'Each tool step shows what it changed in plain words, with Undo next to the change.',
    'Result cards: the skipped alarm appears as a real alarm card with its skipped state.',
    'The step still running has the red/orange/gold dots of the current app, and the reply streams with a red caret.',
    'A message sent while it works is shown as queued, and the composer turns Send into Stop.',
    'PC adds Changes in this chat (with Undo), what it can see, and suggestions.'] },
};

export function compare(s) {
  const x = INFO[s];
  const crop = x.crop ? CROP[x.crop] : null;
  const k = 1100 / (crop?.[2] ?? 1100);
  const cur = x.snap
    ? `<img src="${SNAP(x.snap)}" style="width:390px;height:867px;display:block;box-shadow:inset 0 0 0 1px var(--line)">`
    : `<div class="card" style="width:390px;height:867px;padding:24px;font:400 14px/1.6 var(--mono);color:var(--muted)">There is no Android snapshot of Attendance (android/app/src/test/snapshots has none).<br><br>Today it is the second tab of Schedule: one block per course with its name, a percentage (teal, red under 75%), “✓ yes ✗ no – off · n not marked”, and a row of small boxes per session with the date under each (Attendance.kt). Tapping a box cycles Attended / Absent / Off.</div>`;
  const spec = crop
    ? `<div style="width:1100px;height:${Math.round(crop[3] * k)}px;overflow:hidden;position:relative;box-shadow:inset 0 0 0 1px var(--line)"><img src="../../redesign/mockup.png" style="position:absolute;width:${1540 * k}px;left:${-crop[0] * k}px;top:${-crop[1] * k}px"></div>`
    : `<div class="card" style="width:1100px;height:200px;padding:24px;font:400 14px/1.6 var(--mono);color:var(--muted)">The 0.3 spec (docs/redesign/mockup.png) only drew Now and the Assistant, on desktop and phone. This screen had no spec mockup; the current app on the left is the reference.</div>`;
  const lbl = (t, sub = '') => `<div class="eyebrow" style="margin-bottom:12px;color:var(--soft)">${t}${sub ? ` <span class="faint">· ${sub}</span>` : ''}</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${x.title} · compare</title><link rel="stylesheet" href="../style.css"></head><body style="padding:40px;overflow:hidden">
  <div class="row" style="align-items:baseline;gap:16px;margin-bottom:28px"><h1 style="font:800 30px/1 var(--mono);letter-spacing:-.02em">${x.title}</h1><span class="muted" style="font:500 14px/1 var(--mono)">current app → round 5</span></div>
  <div style="display:flex;gap:40px;align-items:flex-start">
    <div>${lbl('Now · Android 0.3.4', x.snap ? 'Paparazzi snapshot' : 'no snapshot')}${cur}</div>
    <div>${lbl('Round 5 · phone', '390 × 844')}<img src="../png/${s}-phone.png" style="width:390px;height:844px;display:block;box-shadow:0 0 0 1px var(--line2),0 24px 48px -24px rgba(0,0,0,.8)"></div>
    <div>${lbl('0.3 spec · PC', crop ? crop[4] : 'none')}${spec}
      <div style="margin-top:32px">${lbl('What is better')}<ul style="margin:0;padding-left:20px;font:400 15px/1.55 var(--sans);color:#e4e4e4;max-width:1080px">${x.better.map((b) => `<li style="margin-bottom:8px">${b}</li>`).join('')}</ul></div></div>
  </div>
  <div style="margin-top:40px">${lbl('Round 5 · PC', '2560 × 1440, shown at 1500 × 844')}<img src="../png/${s}-pc.png" style="width:1500px;height:844px;display:block;box-shadow:0 0 0 1px var(--line2)"></div>
  </body></html>`;
}
