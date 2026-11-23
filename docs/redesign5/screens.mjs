import { ic, logo, C, cc, tint, WEEK, DAYS, LONG, hm, NOW, LIVE_P, NOTES, noteRow, phone, appHead, pc } from './parts.mjs';
export { MOTIONS, compare } from './extras.mjs';

const stack = (...xs) => `<div class="stack">${xs.join('')}</div>`;
const sec = (t, small = '', link = '', style = '') => `<div class="sec" style="${style}">${t}${small ? `<small>${small}</small>` : ''}<span class="grow"></span>${link ? `<a>${link}</a>` : ''}</div>`;
const subtabs = (opts, on) => `<div class="subtabs">${opts.map((o) => `<span class="${o === on ? 'on' : ''}">${o}</span>`).join('')}</div>`;

// ---------- Now ----------
const progress = (ticks = 3) => `<div class="prog"><div class="bar" style="--p:${LIVE_P}%"><i></i>${Array.from({ length: ticks }, (_, k) => `<s style="left:${((k + 1) * 100) / (ticks + 1)}%"></s>`).join('')}<b></b></div><div class="ends num"><span>08:00</span><span class="nowlbl">09:37 now</span><span>10:00</span></div></div>`;
const liveCard = ({ big = false, notes = false } = {}) => `<section class="live" ${big ? 'style="padding:28px 32px 28px 36px"' : ''}>
  <div class="top"><span class="tag onair"><i class="pulse"></i>Live</span><span class="tag line">Lecture</span><span class="left num"><b ${big ? 'style="font-size:30px"' : ''}>23</b>min left</span></div>
  <h2 ${big ? 'style="font-size:44px;margin-top:16px"' : ''}>Algorithms</h2>
  <div class="meta num" ${big ? 'style="font-size:15px;margin-top:8px"' : ''}>08:00 – 10:00 · Room 4.12 · Dr. Okafor</div>
  ${progress(big ? 7 : 3)}
  ${notes ? `<div class="notes">${[['Dynamic programming', 'Today'], ['Exam formula sheet', 'Pinned']].map(([t, w]) => `<div class="ln">${ic('notes', 's16')}<span>${t}</span><small>${w}</small></div>`).join('')}</div>` : ''}
  <div class="acts" ${big ? 'style="max-width:680px;margin-top:24px"' : ''}><span class="btn primary">${ic(notes ? 'edit' : 'notes', 's18')}<span>${big ? 'Notes for this class' : notes ? 'New note' : 'Open notes'}</span></span><span class="btn">${ic('usercheck', 's18')}<span>Mark attended</span></span>${big ? `<span class="btn icon">${ic('more', 's18')}</span>` : ''}</div>
</section>`;
const TODAY_REST = [
  ['lin', '11:00', 'Linear Algebra', 'Tutorial · B204', 'in 1 h 23 m'],
  ['print', '13:30', 'Printmaking', 'Studio · NB631 · until 16:00', ''],
  ['study', '16:15', 'Study group', 'Library · until 17:30', ''],
];
const restOfToday = ({ chip = false } = {}) => `<div class="tl">${TODAY_REST.map(([k, t, h, m, cd]) => `<div class="it ${cd ? 'next' : ''}" style="${cc(k)}"><span class="t num">${t}</span><span class="n"></span><span class="b"><div class="h">${h}</div><div class="m">${m}</div>${cd && !chip ? `<div class="cdl num">Next · starts ${cd}</div>` : ''}</span>${cd && chip ? `<span class="cd num"><small>NEXT</small>${cd}</span>` : '<span></span>'}</div>`).join('')}</div>`;
const ring = (p, icon = 'pause', size = 40) => { const r = 17, c = 2 * Math.PI * r; return `<span class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 40 40" style="width:${size}px;height:${size}px"><circle class="tr" cx="20" cy="20" r="${r}"/><circle class="pr" cx="20" cy="20" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/></svg><span class="ic">${ic(icon, 's16')}</span></span>`; };
const timerTile = () => `<div class="tile">${ring(0.75)}<div class="grow"><div class="big num">18:42</div><div class="sub ell">Problem set 3</div></div></div>`;
const alarmTile = () => `<div class="tile"><span class="bellbox">${ic('bell', 's18')}</span><div class="grow"><div class="big num">07:15</div><div class="sub ell">Wake up · Wed</div></div></div>`;
const clock = (size = 76) => `<div class="eyebrow" style="color:var(--soft)">Tuesday 6 October <span class="faint">· week 6</span></div><div class="num" style="display:flex;align-items:baseline;gap:6px;margin-top:4px"><span style="font:800 ${size}px/1 var(--mono);letter-spacing:-.05em">09:37</span><span style="font:700 ${Math.round(size * 0.3)}px/1 var(--mono);color:var(--faint)">12</span></div>`;
function dayStrip() {
  const a = 8, b = 18, x = (h) => ((h - a) / (b - a)) * 100;
  const blocks = WEEK.filter((e) => e[0] === 2).map(([, s, e, k]) => `<span style="position:absolute;left:${x(s)}%;width:calc(${x(e) - x(s)}% - 2px);top:8px;bottom:8px;background:linear-gradient(180deg, ${tint(C[k].c, 88)}, ${C[k].c});opacity:${s <= NOW ? 1 : .7};${s <= NOW && e > NOW ? `box-shadow:0 0 18px ${C[k].c}` : ''}"></span>`).join('');
  return `<div style="flex:1;min-width:0;padding-bottom:6px"><div class="eyebrow" style="margin-bottom:10px">Today <span class="faint">· 4 sessions · 6 h 45 m of class</span></div><div style="position:relative;height:48px;background:var(--s1);box-shadow:var(--hi),inset 0 0 0 1px var(--line)">${[10, 12, 14, 16].map((h) => `<span style="position:absolute;left:${x(h)}%;top:0;bottom:0;width:1px;background:var(--line)"></span>`).join('')}${blocks}<span style="position:absolute;left:${x(NOW)}%;top:-6px;bottom:-6px;width:2px;background:#fff;box-shadow:0 0 10px 2px rgba(255,120,120,.8)"></span></div><div class="num" style="display:flex;justify-content:space-between;margin-top:8px;font:500 11px var(--mono);color:var(--faint)">${[8, 10, 12, 14, 16, 18].map((h) => `<span>${hm(h)}</span>`).join('')}</div></div>`;
}
const upcoming = () => `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${[
  ['lin', 'flag', 'Quiz 2 · Linear Algebra', 'Fri 9 Oct · 09:00 · B204', 'in 3 days', 'var(--ink)'],
  ['phys', 'notes', 'Lab 3 report due', 'Thu 8 Oct · before the lab', 'in 2 days', 'var(--gold)'],
  [null, 'checklist', 'Inbox · This week', '2 of 4 to-dos left', 'today', 'var(--muted)'],
].map(([k, icon, h, m, w, col]) => `<div class="tile" style="padding:16px;${k ? cc(k) : ''}"><span class="bellbox" style="color:${k ? `var(--cct)` : 'var(--soft)'}">${ic(icon, 's18')}</span><div class="grow"><div style="font:700 15px/20px var(--mono)">${h}</div><div class="sub">${m}</div></div><span class="num" style="font:700 12px/1 var(--mono);color:${col}">${w}</span></div>`).join('')}</div>`;
const termBars = () => `<div class="card raised" style="padding:24px">${sec('Attendance', 'term to date', 'Open')}${[['algo', 91], ['lin', 100], ['print', 83], ["hist", 70]].map(([k, p]) => `<div style="${cc(k)};margin-top:14px"><div class="row" style="font:500 13px/1 var(--mono)"><span class="dot" style="width:8px;height:8px"></span><span class="grow">${C[k].name}</span><b class="num" style="color:${p < 75 ? 'var(--ink)' : 'var(--fg)'}">${p}%</b></div><div style="position:relative;height:6px;margin-top:8px;background:var(--s4)"><i style="position:absolute;inset:0 ${100 - p}% 0 0;background:${p < 75 ? 'var(--accent)' : 'var(--cc)'}"></i><i style="position:absolute;left:75%;top:-3px;bottom:-3px;width:1px;background:var(--muted)"></i></div></div>`).join('')}</div>`;

export const now = {
  phone: () => phone({ tab: 'now', head: appHead(), body: `
    <div style="padding:0 4px 16px">${clock(60)}</div>
    ${liveCard({ notes: true })}
    <div class="tiles" style="margin-top:12px">${timerTile()}${alarmTile()}</div>
    ${sec('Rest of today', '3 more', '', 'margin-top:24px;margin-bottom:4px')}
    ${restOfToday()}` }),
  pc: () => pc({ on: 'now', title: 'Now', crumb: 'Algorithms · live until 10:00', cols: '1fr 520px', content: `
    <div class="col">
      <div style="display:flex;align-items:flex-end;gap:48px"><div>${clock(120)}</div>${dayStrip()}</div>
      ${liveCard({ big: true })}
      <div>${sec('Notes for this class', '3 · Algorithms', 'All Algorithms notes')}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start">${noteRow('dp', { lines: 4 })}${noteRow('ps3', { todoMax: 4 })}${noteRow('sheet', { lines: 4 })}</div></div>
      <div>${sec('Coming up', 'this week')}${upcoming()}</div>
    </div>
    <div class="col" style="gap:28px">
      <div class="card raised" style="padding:24px">${sec('Rest of today', '3 more')}${restOfToday({ chip: true })}</div>
      <div>${sec('Running')}<div class="stack">${timerTile()}<div class="tile">${ring(0.4, 'coffee')}<div class="grow"><div class="big num" style="color:var(--soft)">06:00</div><div class="sub">Break · paused</div></div><span class="btn sm">Resume</span></div></div></div>
      <div>${sec('Next alarms')}<div class="stack">${alarmTile()}<div class="tile"><span class="bellbox" style="color:var(--teal-ink)">${ic('bell', 's18')}</span><div class="grow"><div class="big num">10:30</div><div class="sub ell">30 min before Linear Algebra · today</div></div><span class="btn sm ghost">${ic('skip', 's16')}Skip</span></div></div></div>
      ${termBars()}
    </div>` }),
};

// ---------- Schedule (current structure: Week / Month lists by day with Today) ----------
const ev = ([d, s, e, k, kind, title], { compact = false, past = false, live = false } = {}) => {
  const co = C[k];
  const room = co.room;
  const now = live ? `<span class="fill" style="--p:${LIVE_P}%"></span><span class="nowline" style="top:calc(${LIVE_P}% - 1px)"><span>09:37</span></span>` : '';
  if (compact) return `<div class="card ev ${past ? 'past' : ''} ${live ? 'is-live' : ''}" style="${cc(k)}"><span class="cc-edge"></span>${now}<span class="tm num">${hm(s)} – ${hm(e)}</span><span class="h">${title || co.name}</span><span class="s">${kind} · ${room}</span>${live ? '<span class="s ink" style="font-weight:700">23 min left</span>' : ''}</div>`;
  return `<div class="card ev ${past ? 'past' : ''} ${live ? 'is-live' : ''}" style="${cc(k)}"><span class="cc-edge"></span>${now}<span class="tm num">${hm(s)}<small>${hm(e)}</small></span><span><div class="h">${title || co.name}</div><div class="s">${kind}${co.who ? ` · ${co.who}` : ''}</div></span><span class="r">${room}${live ? '<span class="ink">23 min left</span>' : ''}</span></div>`;
};
const dayEvents = (d) => WEEK.filter((e) => e[0] === d);
export const schedule = {
  phone: () => phone({ tab: 'schedule', head: appHead(), after: subtabs(['Week', 'Attendance'], 'Week'), body: `
    <div class="row" style="padding:16px 0 12px"><div class="grow"><div style="font:800 22px/1.1 var(--mono);letter-spacing:-.02em">5 – 11 October</div><div class="eyebrow" style="margin-top:6px">Week 6 <span class="faint">· 13 sessions</span></div></div><span class="btn icon ghost">${ic('left')}</span><span class="btn icon ghost">${ic('right')}</span></div>
    <div class="row"><span class="seg"><span class="on">Week</span><span>Month</span></span><span class="grow"></span><span class="btn sm ghost">${ic('now', 's16')}Today</span></div>
    <div class="dayh">Mon 5 Oct<small>done</small></div>
    <div class="card daypast"><span class="teal">${ic('check', 's16')}</span><span class="grow">Both attended</span><span class="faint">2 sessions</span></div>
    <div class="dayh today"><b>Today</b> · Tue 6 Oct<small>4 sessions</small></div>
    ${ev(dayEvents(2)[0], { live: true })}<div style="height:8px"></div>${dayEvents(2).slice(1).map((e) => ev(e)).join('<div style="height:8px"></div>')}
    <div class="dayh">Wed 7 Oct<small>2 sessions</small></div>
    ${dayEvents(3).map((e) => ev(e)).join('<div style="height:8px"></div>')}`, fab: `<span class="fab">${ic('plus', 's24')}</span>` }),
  pc: () => pc({ on: 'schedule', sub: 'schedule', title: 'Schedule', crumb: '5 – 11 October · week 6', cols: '1fr 440px',
    tools: `<span class="row" style="margin-left:24px"><span class="seg"><span class="on">Week</span><span>Month</span></span><span class="btn sm ghost">${ic('left', 's16')}</span><span class="btn sm ghost">${ic('right', 's16')}</span><span class="btn sm">${ic('now', 's16')}Today</span><span class="btn sm primary">${ic('plus', 's16')}Add</span></span>`,
    content: `<div class="col" style="gap:28px"><div class="wk">${DAYS.map((label, i) => {
      const d = i + 1, evs = dayEvents(d), [dn, num] = label.split(' ');
      const body = evs.length ? evs.map((e) => ev(e, { compact: true, past: d === 1 || (d === 2 && e[2] <= NOW), live: d === 2 && e[1] <= NOW && e[2] > NOW })).join('') : '<div class="free">Free day</div>';
      return `<div class="dc ${d === 2 ? 'today' : ''}"><div class="dch"><b class="num">${num}</b><span>${d === 2 ? 'TODAY' : dn.toUpperCase()}</span><small>${evs.length || ''}</small></div>${body}</div>`;
    }).join('')}</div><div>${sec('This week', '13 sessions · 18 h 15 m of class · 4 of 4 attended so far')}${upcoming()}</div></div>
    <div class="col" style="gap:24px">${sessionPanel()}</div>` }),
};
function sessionPanel() {
  return `<section class="live" style="padding:24px 24px 24px 28px"><div class="top"><span class="tag onair"><i class="pulse"></i>Live</span><span class="tag line">Lecture</span><span class="left num"><b>23</b>min left</span></div><h2>Algorithms</h2><div class="meta">Tue 6 Oct · 08:00 – 10:00</div>${progress(3)}</section>
  <div class="card raised" style="padding:20px">${[['place', 'Room 4.12', 'Building B, floor 4'], ['person', 'Dr. Okafor', 'Office hours Wed 13:00'], ['bell', 'Alarm 07:30', '30 min before · rings Thu next']].map(([i, h, s]) => `<div class="row" style="padding:10px 0;align-items:flex-start;gap:14px"><span class="muted" style="margin-top:2px">${ic(i, 's18')}</span><div><div style="font:700 14px/20px var(--mono)">${h}</div><div style="font:400 12px/18px var(--mono);color:var(--muted)">${s}</div></div></div>`).join('')}</div>
  <div>${sec('Attendance', 'this session')}<div class="mark" style="margin-top:0"><span>${ic('check', 's16')}Attended</span><span>${ic('x', 's16')}Absent</span><span>${ic('minus', 's16')}Off</span></div></div>
  <div>${sec('Notes', '3')}${stack(noteRow('dp'), noteRow('ps3', { todoMax: 2 }))}</div>`;
}

// ---------- Attendance (current structure: a tab of Schedule, per-course sessions, Attended / Absent / Off) ----------
// a attended, x absent, o off, u not marked, f future
const ATT = {
  algo: { s: 'aaaoaaxaaaauf', n: [10, 1, 1, 1], left: 1 },
  lin: { s: 'aaaaaaaaaaaaaf', n: [13, 0, 0, 0], left: 1 },
  hist: { s: 'aaxaxaaxaaf', n: [7, 3, 0, 0], left: 1 },
  print: { s: 'aaaaaxff', n: [5, 1, 0, 0], left: 2 },
};
const pct = (k) => { const [a, x] = ATT[k].n; return Math.round((a / (a + x)) * 100); };
const course = (k, { big = false } = {}) => {
  const A = ATT[k], p = pct(k), low = p < 75, [a, x, o, u] = A.n;
  const sqs = [...A.s].map((c, i) => `<i class="${c} ${c === 'u' ? 'today' : ''}" ${big ? 'style="width:28px;height:28px"' : ''}>${c === 'a' ? '' : c === 'x' ? '' : c === 'o' ? '–' : ''}</i>`).join('');
  return `<div class="card course" style="${cc(k)}"><span class="cc-edge"></span><div class="hd"><span class="nm">${C[k].name}</span><span class="pcnt num" style="color:${low ? 'var(--ink)' : 'var(--teal-ink)'}">${p}%</span></div>
  <div class="st num"><span class="teal">✓ ${a}${big ? ' attended' : ''}</span><span class="${x ? 'ink' : ''}">✗ ${x}${big ? ' absent' : ''}</span><span>– ${o}${big ? ' off' : ''}</span>${u ? `<span class="gold">● ${u} to mark</span>` : ''}<span class="faint">${A.left} to come</span></div>
  <div class="sq">${sqs}</div>
  ${low ? `<div class="warn">${ic('warning', 's16')}<span>Below 75%. One more absence takes it to <b>64%</b>; 4 sessions left this term.</span></div>` : ''}
  ${u && k === 'algo' ? `<div class="mark"><span>${ic('check', 's16')}Attended</span><span>${ic('x', 's16')}Absent</span><span>${ic('minus', 's16')}Off</span></div><div class="faint" style="font:500 11px/1 var(--mono);margin-top:8px">Today · Lecture 08:00 · live now</div>` : ''}</div>`;
};
const summary = (wide = false) => `<div class="card raised sum"><div class="row" style="align-items:flex-end;gap:16px"><span class="big num">87%</span><div style="padding-bottom:4px"><div style="font:700 14px/20px var(--mono)">attended this term</div><div class="muted" style="font:400 12px/18px var(--mono)">36 of 41 sessions so far</div></div></div>
  <div class="stackbar"><i style="flex:36;background:var(--teal)"></i><i style="flex:4;background:var(--accent)"></i><i style="flex:1;background:var(--s4)"></i><i style="flex:1;box-shadow:inset 0 0 0 1px var(--muted)"></i></div>
  <div class="legend"><span><i style="background:var(--teal)"></i>Attended 36</span><span><i style="background:var(--accent)"></i>Absent 4</span><span><i style="background:var(--s4)"></i>Off 1</span><span><i style="box-shadow:inset 0 0 0 1px var(--muted)"></i>To mark 1</span></div></div>`;
export const attendance = {
  phone: () => phone({ tab: 'schedule', head: appHead(), after: subtabs(['Week', 'Attendance'], 'Attendance'), body: `<div style="height:16px"></div>${summary()}${sec('Courses', '4', '', 'margin-top:24px')}${course('algo')}${course('hist')}${course('lin')}` }),
  pc: () => pc({ on: 'schedule', sub: 'attendance', title: 'Attendance', crumb: 'Autumn term · week 6 of 14', cols: '1fr 460px',
    tools: `<span class="row" style="margin-left:24px"><span class="seg"><span class="on">Term</span><span>This week</span></span></span>`,
    content: `<div class="col" style="gap:16px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start"><div class="stack">${course('algo', { big: true })}${course('lin', { big: true })}</div><div class="stack">${course('hist', { big: true })}${course('print', { big: true })}</div></div>${heat()}</div>
    <div class="col" style="gap:24px">${summary(true)}
      <div class="card raised" style="padding:20px">${sec('To mark', '1')}<div class="row" style="${cc('algo')};gap:12px"><span class="dot"></span><div class="grow"><div style="font:700 15px/20px var(--mono)">Algorithms · Lecture</div><div class="muted" style="font:400 12px/18px var(--mono)">Today 08:00 – 10:00 · live now</div></div></div><div class="mark"><span class="on">${ic('check', 's16')}Attended</span><span>${ic('x', 's16')}Absent</span><span>${ic('minus', 's16')}Off</span></div></div>
      <div class="card" style="padding:20px">${sec('Legend')}<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;font:500 13px/1 var(--mono);color:var(--soft)"><span class="sq" style="margin:0;align-items:center;gap:10px"><i class="a"></i>Attended</span><span class="sq" style="margin:0;align-items:center;gap:10px"><i class="x"></i>Absent</span><span class="sq" style="margin:0;align-items:center;gap:10px"><i class="o">–</i>Off</span><span class="sq" style="margin:0;align-items:center;gap:10px"><i class="u"></i>To mark</span><span class="sq" style="margin:0;align-items:center;gap:10px"><i class="f"></i>To come</span></div></div>
    </div>` }),
};

// ---------- Notes list ----------
const chips = (on = 'All') => `<div class="hscroll">${[['All', null, 42], ['Algorithms', 'algo', 12], ['Linear Algebra', 'lin', 9], ['Printmaking', 'print', 7], ['Modern History', 'hist', 8], ['Physics Lab', 'phys', 4]].map(([l, k, n]) => `<span class="chip ${l === on ? 'on' : ''}" ${k ? `style="${cc(k)}"` : ''}>${k ? '<span class="dot"></span>' : ''}${l}<span class="n num">${n}</span></span>`).join('')}</div>`;
const composer = () => `<div class="field" style="height:48px;background:var(--s1);box-shadow:var(--hi),inset 0 0 0 1px var(--line)"><span class="muted">${ic('edit', 's18')}</span><span class="grow">Take a note for Algorithms…</span><span class="muted">${ic('checklist', 's18')}</span><span class="muted">${ic('image', 's18')}</span></div>`;
export const notes = {
  phone: () => phone({ tab: 'notes', head: appHead(), body: `
    <div class="row" style="padding:4px 0 16px"><h1 style="font:800 28px/1 var(--mono);letter-spacing:-.02em" class="grow">Notes</h1><span class="btn icon ghost">${ic('search')}</span></div>
    ${chips()}<div style="height:12px"></div>${composer()}
    ${sec('Algorithms · live now', '2', '', 'margin-top:24px')}${stack(noteRow('dp'), noteRow('ps3'))}
    ${sec('Pinned', '2', '', 'margin-top:24px')}${stack(noteRow('sheet'), noteRow('read'))}` }),
  pc: () => pc({ on: 'notes', title: 'Notes', crumb: '42 notes · 6 courses', cols: '240px 1fr',
    tools: `<span class="row" style="margin-left:24px"><span class="seg"><span class="on">${ic('list', 's16')}Cards</span><span>Sessions</span></span><span class="btn sm primary">${ic('plus', 's16')}New note</span></span>`,
    content: `<div class="col rail" style="gap:4px">${[['All notes', null, 42, true], ['Inbox', null, 3], ['Pinned', null, 4]].map(([l, k, n, on]) => `<span class="nav ${on ? 'on' : ''}">${ic(l === 'Pinned' ? 'pin' : l === 'Inbox' ? 'drive' : 'notes', 's18')}<span>${l}</span><span class="cnt">${n}</span></span>`).join('')}<div class="eyebrow" style="padding:20px 12px 8px">Courses</div>${['algo', 'lin', 'print', 'hist', 'phys', 'study'].map((k, i) => `<span class="nav" style="${cc(k)}"><span class="dot"></span><span>${C[k].name}</span><span class="cnt">${[12, 9, 7, 8, 4, 2][i]}</span></span>`).join('')}</div>
    <div class="col" style="gap:24px">${composer()}
      <div>${sec('Algorithms · live now', '2 notes from today', 'Open the class')}<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;align-items:start">${noteRow('dp', { lines: 4 })}${noteRow('ps3', { todoMax: 4 })}${noteRow('sheet', { lines: 4 })}${noteRow('week', { todoMax: 4 })}</div></div>
      <div>${sec('Recent', 'this week')}<div class="masonry" style="column-count:4">${['eig', 'lino', 'lab', 'essay', 'greedy', 'matrix', 'read'].map((k, i) => noteRow(k, { lines: [4, 6, 4, 4, 6, 4, 4][i] })).join('')}</div></div>
    </div>` }),
};

// ---------- An open note with a checklist ----------
const noteBody = () => `<div class="prose">
  <p>Q2 and Q4 are <b>knapsack</b> variants; Q5 needs the LCS table from Tuesday's lecture. Due <mark>Friday 23:59</mark> on the portal.</p>
  <h3>Before Friday</h3>
  <ul class="todo"><li class="done">Read chapter 15.3 on LCS</li><li class="done">Draw the knapsack table for Q2</li><li>Write the recurrence for Q4 and check it on the <b>5-item example</b> from class</li><li>Ask Dr. Okafor about Q5 in office hours</li></ul>
  <h3>Recurrence for Q4</h3>
  <p>dp[i][w] = max(dp[i−1][w], v<sub>i</sub> + dp[i−1][w − w<sub>i</sub>]). Fill rows top to bottom; the answer is the last cell.</p>
  <ul class="b"><li>Base row is all zeros</li><li>Items heavier than w copy the row above</li></ul></div>`;
export const note = {
  phone: () => phone({ tab: null, fade: false,
    head: `<header class="ph-head" style="padding:0 8px 0 4px;gap:4px"><span class="hbtn">${ic('back', 's24')}</span><span class="cchip" style="${cc('algo')}"><span class="dot"></span>Algorithms${ic('down', 's16')}</span><span class="grow"></span><span class="row muted" style="font:500 12px/1 var(--mono);gap:4px;margin-right:4px">${ic('check', 's16')}Saved</span><span class="hbtn gold">${ic('pin')}</span><span class="hbtn">${ic('more')}</span></header>`,
    body: `<div class="eyebrow" style="margin-top:12px">Tue 6 Oct · Lecture 08:00 <span class="ink">· live</span></div><h1 class="ed-title" style="margin:8px 0 6px">Problem set 3 plan</h1><div class="row" style="font:500 12px/1 var(--mono);color:var(--muted);margin-bottom:20px"><span>2 of 4 done</span><span style="flex:1;height:4px;background:var(--s4);position:relative"><i style="position:absolute;inset:0 50% 0 0;background:var(--accent)"></i></span></div>${noteBody()}`,
    foot: `<div class="edbar"><div class="fmt" style="width:100%;justify-content:space-between">${['bold', 'italic', 'underline', 'heading', 'list', 'checklist', 'image'].map((k) => `<span class="fb ${k === 'checklist' ? 'on' : ''}">${ic(k)}</span>`).join('')}<span class="sel">Aa${ic('down', 's16')}</span></div></div>` }),
  pc: () => pc({ on: 'notes', title: 'Problem set 3 plan', crumb: 'Algorithms · Tue 6 Oct', cols: '360px 1fr 340px',
    tools: `<span class="row muted" style="margin-left:24px;font:500 12px/1 var(--mono);gap:6px">${ic('check', 's16')}Saved · synced</span>`,
    content: `<div class="col" style="gap:8px">${sec('Algorithms', '12 notes')}${['ps3', 'dp', 'sheet', 'greedy'].map((k) => k === 'ps3' ? noteRow(k, { todoMax: 2 }).replace('class="card nrow"', 'class="card nrow" style="background:var(--s3);box-shadow:var(--lift),inset 0 0 0 1px var(--line2)"') : noteRow(k)).join('')}</div>
    <div class="card raised" style="display:flex;flex-direction:column;min-height:0;overflow:hidden"><div class="fmt" style="padding:12px 16px;box-shadow:inset 0 -1px 0 var(--line)"><span class="sel">Noto Sans${ic('down', 's16')}</span><span class="sel">16${ic('down', 's16')}</span><span class="div"></span>${['bold', 'italic', 'underline', 'strike'].map((k) => `<span class="fb">${ic(k)}</span>`).join('')}<span class="div"></span>${['heading', 'list', 'checklist'].map((k) => `<span class="fb ${k === 'checklist' ? 'on' : ''}">${ic(k)}</span>`).join('')}<span class="div"></span>${['image', 'link', 'clip'].map((k) => `<span class="fb">${ic(k)}</span>`).join('')}<span class="grow"></span><span class="fb gold">${ic('pin')}</span><span class="fb">${ic('history')}</span><span class="fb">${ic('more')}</span></div>
      <div style="padding:40px 0;overflow:hidden"><div style="max-width:760px;margin:0 auto"><div class="eyebrow">Tue 6 Oct · Lecture 08:00 <span class="ink">· live</span></div><h1 class="ed-title" style="font-size:36px;margin:10px 0 28px">Problem set 3 plan</h1>${noteBody()}</div></div></div>
    <div class="col" style="gap:16px"><section class="live" style="padding:20px 20px 20px 24px"><div class="top"><span class="tag onair"><i class="pulse"></i>Live</span><span class="left num"><b style="font-size:18px">23</b>min</span></div><h2 style="font-size:22px">Algorithms</h2><div class="meta">Lecture · Room 4.12</div><div class="acts" style="margin-top:16px"><span class="btn sm">${ic('usercheck', 's16')}Mark attended</span></div></section>
      <div class="card" style="padding:20px">${sec('Checklist')}<div class="num" style="font:800 28px/1 var(--mono)">2<span class="faint" style="font-size:16px"> / 4</span></div><div style="height:6px;background:var(--s4);margin-top:12px;position:relative"><i style="position:absolute;inset:0 50% 0 0;background:var(--accent);box-shadow:0 0 10px rgba(177,66,66,.6)"></i></div></div>
      <div class="card" style="padding:20px">${sec('Versions', '6')}${[['09:31', 'You · iPhone'], ['08:52', 'You · MARO-PC'], ['Mon 21:10', 'You · MARO-PC']].map(([t, w], i) => `<div class="row" style="padding:8px 0;font:500 13px/1 var(--mono)"><span class="num" style="width:84px;color:${i ? 'var(--muted)' : 'var(--fg)'}">${t}</span><span class="muted grow">${w}</span>${i ? '' : '<span class="tag">Now</span>'}</div>`).join('')}</div>
      <div class="card" style="padding:20px">${sec('Attached', '1')}<div class="row" style="gap:12px"><span style="width:56px;height:56px;background:linear-gradient(135deg,#2a2a2a,#1a1a1a);box-shadow:inset 0 0 0 1px var(--line2);display:grid;place-items:center" class="muted">${ic('image')}</span><div><div style="font:700 13px/18px var(--mono)">knapsack-table.png</div><div class="muted" style="font:400 12px/18px var(--mono)">Drive · Algorithms · 240 KB</div></div></div></div>
    </div>` }),
};

// ---------- Alarms (Time tab) ----------
const alarm = ({ t, label, sub, days, on = true, skip = null, soon = '', cls = '' }) => `<div class="card al ${on ? '' : 'off'} ${skip ? 'skipped' : ''} ${cls}"><div><div class="tt num">${t}</div><div class="lb">${label}</div><div class="ds">${sub}</div>${soon ? `<div class="ds num" style="color:var(--teal-ink);font-weight:700">Next ring ${soon}</div>` : ''}${skip ? `<div class="skipline">${ic('skip', 's16')}<span>Skipped once · <s>${skip[0]}</s></span></div><div class="ds" style="margin-top:2px">Rings again ${skip[1]}</div>` : ''}</div><span class="switch ${on ? 'on' : ''}"></span>
  <div class="ft">${days ? `<span class="days">${'MTWTFSS'.split('').map((d, i) => `<i class="${days.includes(i + 1) ? 'on' : ''}">${d}</i>`).join('')}</span>` : ''}<span class="grow"></span>${skip ? `<span class="btn sm ghost">${ic('undo', 's16')}Undo skip</span>` : on && soon ? `<span class="btn sm ghost">${ic('skip', 's16')}Skip once</span>` : ''}</div></div>`;
const ALARMS = [
  { t: '10:30', label: 'Linear Algebra in 30 min', sub: 'Before every Linear Algebra session', days: [1, 2, 3, 5], soon: 'today · in 53 min' },
  { t: '07:30', label: 'Algorithms in 30 min', sub: 'Before every Algorithms lecture', days: [2, 4], skip: ['Thu 8 Oct 07:30', 'Tue 13 Oct 07:30'] },
  { t: '07:15', label: 'Wake up', sub: 'Weekdays · Rising, gentle', days: [1, 2, 3, 4, 5] },
  { t: '09:00', label: 'Gym', sub: 'Saturdays', days: [6], on: false },
];
const nextRing = () => `<div class="nextring"><div class="row"><span class="eyebrow">Next ring</span><span class="grow"></span><span class="num muted" style="font:500 12px/1 var(--mono)">in 53 min</span></div><div style="margin-top:10px"><span class="tt num">10:30</span><div style="margin-top:10px"><div style="font:700 14px/20px var(--mono)">Linear Algebra in 30 min</div><div class="muted" style="font:400 12px/18px var(--mono)">Today · then Wake up 07:15 Wed</div></div></div></div>`;
export const alarms = {
  phone: () => phone({ tab: 'time', head: appHead(), after: subtabs(['Alarms', 'Timers', 'Clock'], 'Alarms'), body: `<div style="height:16px"></div>${nextRing()}<div class="sec" style="margin-top:24px">Alarms<small>4 · 3 on</small><span class="grow"></span><span class="btn sm">${ic('plus', 's16')}New</span></div>${ALARMS.map(alarm).join('')}` }),
  pc: () => pc({ on: 'time', sub: 'alarms', title: 'Alarms', crumb: '4 alarms · 3 on', cols: '1fr 480px',
    tools: `<span class="row" style="margin-left:24px"><span class="seg"><span class="on">Alarms</span><span>Timers</span><span>World clock</span></span><span class="btn sm primary">${ic('plus', 's16')}New alarm</span></span>`,
    content: `<div class="col" style="gap:24px">${nextRing().replace('class="nextring"', 'class="nextring" style="padding:28px 32px"').replace('class="tt num"', 'class="tt num" style="font-size:88px"')}<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start"><div class="stack">${alarm(ALARMS[0])}${alarm(ALARMS[2])}</div><div class="stack">${alarm(ALARMS[1])}${alarm(ALARMS[3])}</div></div></div>
    <div class="col" style="gap:24px"><div class="card raised" style="padding:24px">${sec('Next 48 hours')}<div class="tl">${[
      ['lin', '10:30', 'Linear Algebra in 30 min', 'Today', ''], ['algo', '07:15', 'Wake up', 'Wed 7 Oct', ''], ['lin', '09:30', 'Linear Algebra in 30 min', 'Wed 7 Oct', ''], ['algo', '07:30', 'Algorithms in 30 min', 'Thu 8 Oct · skipped once', 'skip'],
    ].map(([k, t, h, m, s]) => `<div class="it" style="${cc(k)};${s ? 'opacity:.6' : ''}"><span class="t num">${s ? `<s>${t}</s>` : t}</span><span class="n" style="${s ? 'background:var(--gold)' : ''}"></span><span class="b"><div class="h">${h}</div><div class="m" style="${s ? 'color:var(--gold)' : ''}">${m}</div></span><span></span></div>`).join('')}</div></div>
      <div class="card" style="padding:24px">${sec('Rings on')}${[['iPhone', 'AlarmKit · synced 09:36'], ['Pixel 8', 'Exact alarm · synced 09:37'], ['MARO-PC', 'Hourglass · synced 09:37']].map(([d, s]) => `<div class="row" style="padding:8px 0"><span class="dot" style="--cc:var(--teal);width:8px;height:8px;box-shadow:0 0 8px var(--teal)"></span><span style="font:700 14px/1 var(--mono);width:110px">${d}</span><span class="muted" style="font:400 12px/1 var(--mono)">${s}</span></div>`).join('')}<div class="muted" style="font:400 12px/18px var(--mono);margin-top:12px">Stop on one device and it stops everywhere. A skipped ring never comes back as a snooze.</div></div>
      <div class="card" style="padding:24px">${sec('Sound')}<div class="row"><span class="bellbox">${ic('volume', 's18')}</span><div class="grow"><div style="font:700 14px/20px var(--mono)">Rising</div><div class="muted" style="font:400 12px/18px var(--mono)">Starts soft, full in 60 s · snooze 5 min</div></div><span class="btn sm">Test</span></div></div></div>` }),
};

// ---------- Assistant, working ----------
const chat = (wide = false) => `<div class="msgs" ${wide ? 'style="gap:18px"' : ''}>
  <div class="ub">Skip my alarm on Thursday and move the physics lab to 3 PM</div>
  <div class="step"><span class="k">${ic('check', 's18')}</span><span>Skipped one ring<div class="d">Algorithms in 30 min · Thu 8 Oct 07:30</div></span><span class="btn sm ghost">${ic('undo', 's16')}Undo</span></div>
  <div class="step"><span class="k">${ic('check', 's18')}</span><span>Read your schedule<div class="d">this week · 13 sessions, 1 lab</div></span><span></span></div>
  <div class="say">Thursday's <b>07:30</b> alarm is skipped once. The alarm stays on and rings again on Tuesday.</div>
  <div class="card acard" style="${cc('algo')}"><span class="cc-edge"></span><span class="num" style="font:800 24px/1 var(--mono)">07:30</span><div class="grow"><div style="font:700 13px/18px var(--mono)">Algorithms in 30 min</div><div class="gold" style="font:500 12px/18px var(--mono)">Thu skipped · next Tue 13 Oct</div></div><span class="tag gold">Skipped</span></div>
  <div class="step run"><span class="k"><i class="spin"><b></b><b></b><b></b></i></span><span>Moving an event<div class="d">Physics Lab · Thu 14:00 → 15:00 · 4 s</div></span><span></span></div>
  <div class="say" style="color:var(--soft)">Moving the lab now<span class="caret"></span></div>
  <div class="ub queued">and remind me to bring my lab coat</div><div class="qmeta">Queued · sends after this reply</div>
</div>`;
const composerBox = () => `<div class="composer"><div class="box"><span class="hbtn" style="width:36px;height:36px">${ic('clip')}</span><span class="grow">Ask Hourglass…</span><span class="stopb">${ic('stop', 's18')}</span></div><div class="meta"><span class="sel">Haiku 5.5 · medium${ic('down', 's16')}</span><span class="sel">Auto${ic('down', 's16')}</span><span class="grow"></span><span class="num faint">12k tokens</span></div></div>`;
export const assistant = {
  phone: () => phone({ tab: null, fade: false, head: `<header class="ph-head" style="padding:0 8px 0 4px;gap:6px"><span class="hbtn">${ic('back', 's24')}</span><div class="grow"><div style="font:800 18px/1 var(--mono)">Assistant</div><div class="muted" style="font:500 11px/1 var(--mono);margin-top:5px">Haiku 5.5 · medium · auto</div></div><span class="tag" style="color:var(--ink);background:rgba(177,66,66,.14)"><i class="pulse" style="background:var(--accent)"></i>Working</span><span class="hbtn">${ic('more')}</span></header>`,
    body: chat(), foot: composerBox() }),
  pc: () => pc({ on: 'assistant', title: 'Assistant', crumb: 'Haiku 5.5 · medium · auto mode', busy: true, cols: '1fr 460px',
    tools: `<span class="tag" style="margin-left:16px;color:var(--ink);background:rgba(177,66,66,.14)"><i class="pulse" style="background:var(--accent)"></i>Working · 12 s</span>`,
    content: `<div style="display:flex;flex-direction:column;min-height:0"><div style="flex:1;min-height:0;overflow:hidden"><div style="max-width:880px;margin:0 auto">${chat(true)}</div></div><div style="max-width:880px;width:100%;margin:0 auto">${composerBox().replace('class="composer"', 'class="composer" style="padding:16px 0 0"')}</div></div>
    <div class="col" style="gap:24px"><div class="card raised" style="padding:24px">${sec('Changes in this chat', '2')}${[['check', 'teal', 'Skipped one ring', 'Algorithms · Thu 07:30', 'Undo'], ['spin', 'ink', 'Moving an event', 'Physics Lab · Thu → 15:00', '']].map(([i, col, h, s, b]) => `<div class="row" style="padding:10px 0;gap:12px;align-items:flex-start"><span class="${col}" style="margin-top:1px">${i === 'spin' ? '<i class="spin"><b></b><b></b><b></b></i>' : ic(i, 's18')}</span><div class="grow"><div style="font:700 14px/20px var(--mono)">${h}</div><div class="muted" style="font:400 12px/18px var(--mono)">${s}</div></div>${b ? `<span class="btn sm ghost">${ic('undo', 's16')}${b}</span>` : ''}</div>`).join('')}</div>
      <div class="card" style="padding:24px">${sec('It can see')}${[['now', 'Today', 'Algorithms live, 3 more sessions'], ['bell', 'Alarms', '4 alarms, 1 skipped'], ['notes', 'Notes', '42 notes in 6 courses'], ['drive', 'Drive', '1.2 GB in 214 files']].map(([i, h, s]) => `<div class="row" style="padding:8px 0;gap:12px"><span class="muted">${ic(i, 's18')}</span><span style="font:700 13px/1 var(--mono);width:72px">${h}</span><span class="muted" style="font:400 12px/1 var(--mono)">${s}</span></div>`).join('')}</div>
      <div class="card" style="padding:24px">${sec('Try')}${['What do I need for Friday’s quiz?', 'Tidy up my Problem set 3 note', 'Which classes am I at risk in?'].map((t) => `<div class="field" style="height:40px;margin-top:8px;color:var(--soft);background:var(--s1)">${ic('spark', 's16')}<span>${t}</span></div>`).join('')}</div>
    </div>` }),
};

// Term at a glance: each course, week by week (attended share of that week's sessions).
function heat() {
  const W = { algo: 'aaoaxu........', lin: 'aaaaaa........', hist: 'axaxaa........', print: 'aaaax.........' };
  const col = (c) => c === 'a' ? 'var(--teal)' : c === 'x' ? 'var(--accent)' : c === 'o' ? 'var(--s4)' : c === 'u' ? 'transparent' : 'var(--s1)';
  return `<div class="card raised" style="padding:24px">${sec('Term at a glance', 'week by week · week 6 of 14')}<div class="heat"><span></span>${Array.from({ length: 14 }, (_, i) => `<span class="wh num ${i === 5 ? 'cur' : ''}">W${i + 1}</span>`).join('')}${Object.entries(W).map(([k, w]) => `<span class="hl" style="${cc(k)}"><span class="dot"></span>${C[k].name}</span>${[...w].map((c, i) => `<i style="background:${col(c)};${c === 'u' ? 'box-shadow:inset 0 0 0 1.5px var(--muted)' : c === '.' ? 'box-shadow:inset 0 0 0 1px var(--line)' : ''}${i === 5 ? ';outline:1px solid rgba(177,66,66,.7);outline-offset:1px' : ''}"></i>`).join('')}`).join('')}</div></div>`;
}
