// Writes every Hourglass screen as static HTML from one set of parts, so phone and desktop share one system.
// node generate.mjs  ->  screens/*.html (responsive window), phone/*.html (same page in a phone frame), manifest.json
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// ---------- parts ----------
const G = {
  now: 'f017', week: 'f073', time: 'f252', plus: 'f067', search: 'f002', pin: 'f08d', place: 'f041', trash: 'f1f8', edit: 'f040',
  close: 'f00d', check: 'f00c', play: 'f04b', pause: 'f04c', stop: 'f04d', left: 'f053', right: 'f054', note: 'f249', bell: 'f0f3',
  reminder: 'f0a2', sync: 'f021', person: 'f007', back: 'f060', folder: 'f07b', 'folder-open': 'f07c', 'calendar-plus': 'f271',
  timer: 'f254', down: 'f078', gear: 'f013', globe: 'f0ac', bold: 'f032', italic: 'f033', underline: 'f0cd', strike: 'f0cc',
  'list-ul': 'f0ca', 'list-ol': 'f0cb', heading: 'f1dc', image: 'f03e', clip: 'f0c6', file: 'f15b', upload: 'f093', download: 'f019',
  'check-square': 'f14a', drive: 'f0a0', grid: 'f00a', link: 'f0c1', share: 'f1e0', move: 'f047', font: 'f031', size: 'f034',
  more: 'f141', copy: 'f0c5', quote: 'f10d', undo: 'f0e2', redo: 'f01e', 'arrow-right': 'f061', 'arrow-up': 'f062', calendar: 'f133',
  history: 'f1da', lock: 'f023', key: 'f084', sun: 'f185', moon: 'f186', warning: 'f071', tasks: 'f0ae', 'file-pdf': 'f1c1',
  'file-text': 'f15c', 'file-code': 'f1c9', 'file-zip': 'f1c6', 'file-image': 'f1c5', spark: 'f005', command: 'f120', list: 'f03a',
  'user-check': 'f4fc', inbox: 'f01c', cloud: 'f0c2', volume: 'f028', external: 'f08e', refresh: 'f021', minus: 'f068', star: 'f005',
};
const ic = (n, cls = '') => `<i class="ic ${cls}">&#x${G[n]};</i>`;
const ROWS = ['#########', '.#.....#.', '.#ooooo#.', '..#ooo#..', '...#o#...', '...#o#...', '..#.o.#..', '.#.ooo.#.', '.#ooooo#.', '#########'];
const logo = (cell = 2) => `<svg class="logo" width="${9 * cell}" height="${10 * cell}" viewBox="0 0 9 10" shape-rendering="crispEdges">${ROWS.map((r, y) => [...r].map((c, x) => c === '.' ? '' : `<rect x="${x}" y="${y}" width="1" height="1" fill="${c === 'o' ? '#F0BE66' : '#B14242'}"/>`).join('')).join('')}</svg>`;
const btn = (label, { kind = '', icon, kbd, cls = '' } = {}) => `<span class="btn ${kind} ${cls}">${icon ? ic(icon) : ''}${label ? `<span class="l">${label}</span>` : ''}${kbd ? `<kbd>${kbd}</kbd>` : ''}</span>`;
const sqbtn = (icon, cls = '') => `<span class="btn sq ${cls}">${ic(icon)}</span>`;
const chip = (t, tint = '', cls = '') => `<span class="chip ${cls}" ${tint ? `style="--t:${tint}"` : ''}>${t}</span>`;
const seg = (opts, on, cls = '', tint) => `<span class="seg ${cls}">${opts.map((o) => `<span class="${o === on ? 'on' : ''}" ${o === on && tint ? `style="--t:${tint}"` : ''}>${o}</span>`).join('')}</span>`;
const sw = (on) => `<span class="switch ${on ? 'on' : ''}"></span>`;
const days = (on, cls = '') => `<span class="days ${cls}">${'MTWTFSS'.split('').map((d, i) => `<i class="${on.includes(i + 1) ? 'on' : ''}">${d}</i>`).join('')}</span>`;
const sec = (t, small = '', extra = '') => `<div class="sec">${t}${small ? `<small>${small}</small>` : ''}${extra}</div>`;
const field = (v, { ph = false, icon, caret = false, cls = '', label } = {}) => {
  const f = `<span class="field ${ph ? 'ph' : ''} ${cls}">${icon ? ic(icon) : ''}<span class="ell">${v}</span>${caret ? `<i class="caret">${ic('down')}</i>` : ''}</span>`;
  return label ? `<label class="label">${label}${f}</label>` : f;
};

// ---------- the demo week (Tuesday 6 October 2026, 09:37, Cairo) ----------
const C = {
  algo: { name: 'Algorithms', code: 'CS201', c: '#B14242', room: 'Room 4.12', who: 'Dr. Okafor' },
  lin: { name: 'Linear Algebra', code: 'MA210', c: '#4A8B8B', room: 'B204', who: 'Dr. Haddad' },
  print: { name: 'Printmaking', code: 'AR118', c: '#5B8C4A', room: 'NB631', who: 'Ms. Lindqvist' },
  phys: { name: 'Physics Lab', code: 'PH150', c: '#D66E36', room: 'Lab 3', who: 'Dr. Mensah' },
  hist: { name: 'Modern History', code: 'HI240', c: '#C2587E', room: 'Hall C', who: 'Dr. Farouk' },
  study: { name: 'Study group', c: '#F0BE66', room: 'Library' },
  gym: { name: 'Gym', c: '#8A8A8A', room: 'Sports hall' },
};
// day (1 Mon .. 7 Sun), start, end (hours), course, kind
const WEEK = [
  [1, 10, 11.5, 'lin', 'Lecture'], [1, 14, 15.5, 'hist', 'Lecture'],
  [2, 8, 10, 'algo', 'Lecture'], [2, 11, 12, 'lin', 'Tutorial'], [2, 13.5, 16, 'print', 'Studio'], [2, 16.25, 17.5, 'study', 'Event'],
  [3, 10, 11.5, 'lin', 'Lecture'], [3, 14, 15.5, 'hist', 'Lecture'],
  [4, 8, 10, 'algo', 'Lecture'], [4, 14, 17, 'phys', 'Lab'],
  [5, 9, 10, 'lin', 'Exam', 'Quiz 2'], [5, 12, 13, 'algo', 'Tutorial'],
  [6, 10, 11, 'gym', 'Event'],
];
const hm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

const NOTES = {
  dp: { t: 'Dynamic programming', c: 'algo', when: 'Today', p: 'Memoisation vs tabulation. Knapsack table: rows are items, columns are capacity; fill bottom-up and read the answer from the last cell. Overlapping subproblems + optimal substructure = DP.' },
  sheet: { t: 'Exam formula sheet', c: 'algo', when: 'Pinned', pin: true, p: 'Master theorem cases, amortised analysis, the three graph traversals and when each one wins. Bring a printed copy on the 22nd.' },
  greedy: { t: 'Greedy vs DP', c: 'algo', when: 'Thu 1 Oct', p: 'Interval scheduling is greedy-safe; coin change with odd denominations is not. Exchange argument proves greedy correct.' },
  eig: { t: 'Eigenvalues', c: 'lin', when: 'Mon 5 Oct', p: 'det(A − λI) = 0. Trace is the sum of eigenvalues, determinant the product. Symmetric matrices have real eigenvalues and orthogonal eigenvectors.' },
  lino: { t: 'Linocut process', c: 'print', when: 'Tue 29 Sep', p: 'Warm the block before cutting. V-gouge for lines, U-gouge to clear. Ink thin, roll in four directions, burnish from the centre out.' },
  lab: { t: 'Lab 2 report', c: 'phys', when: 'Thu 1 Oct', p: 'Pendulum period vs length. Plot T² against L, the slope gives 4π²/g. Our g came out 9.74 ± 0.08.' },
  essay: { t: 'Essay outline', c: 'hist', when: 'Wed 30 Sep', p: 'Thesis: the 1919 revolution was national before it was social. Three parts: the delegation, the strikes, the settlement.' },
  shop: { t: 'This week', c: null, when: 'Inbox', todo: [['Print the problem set', true], ['Buy lino ink, black', false], ['Book a library room for Tuesday', true], ['Email Dr. Mensah about lab 3', false]] },
  read: { t: 'Reading list', c: 'hist', when: 'Pinned', pin: true, p: 'Fahmy, Ordinary Egyptians. Gershoni & Jankowski, Egypt, Islam and the Arabs. Chapters 2 and 5 first.' },
  matrix: { t: 'Row reduction', c: 'lin', when: 'Wed 30 Sep', p: 'Pivot, scale, eliminate below, then back-substitute. Rank = number of pivots. Free columns give the null space.' },
};
const noteCard = (k, { lines = 2, hover = false, menu = '' } = {}) => {
  const n = NOTES[k];
  const co = n.c ? C[n.c] : null;
  const body = n.todo
    ? `<div class="todo">${n.todo.map(([t, d]) => `<span><i class="box ${d ? 'on' : ''}"></i><span class="ell" ${d ? 'style="color:var(--faint);text-decoration:line-through"' : ''}>${t}</span></span>`).join('')}</div>`
    : `<div class="p ${lines === 4 ? 'l4' : lines === 6 ? 'l6' : ''}">${n.p}</div>`;
  return `<div class="card nc ${hover ? 'hover' : ''}"><div class="t">${n.pin ? `<i class="ic gold">&#x${G.pin};</i>` : ''}<span>${n.t}</span></div>${body}<div class="m">${co ? `<b style="--cc:${co.c};color:color-mix(in srgb, ${co.c} 55%, #f5f5f5)">${co.name}</b><span class="sep"> · </span>` : ''}<span class="w">${n.when}</span></div>${menu}</div>`;
};

// ---------- shell ----------
const NAV = [
  ['TODAY'], ['now', 'now', 'Now', '1'], ['schedule', 'week', 'Schedule', '2'], ['attendance', 'user-check', 'Attendance', '7'],
  ['WRITE'], ['notes', 'note', 'Notes', '3'], ['drive', 'drive', 'Drive', '8'],
  ['TIME'], ['alarms', 'bell', 'Alarms', '4'], ['reminders', 'reminder', 'Reminders', ''], ['timers', 'timer', 'Timers', '5'], ['world', 'globe', 'World clock', '6'],
  ['ASK'], ['assistant', 'spark', 'Assistant', '9'],
];
const TABS = [['now', 'now', 'Now'], ['schedule', 'week', 'Schedule'], ['notes', 'note', 'Notes'], ['time', 'time', 'Time'], ['ask', 'spark', 'Ask']];
function sidebar(on, { live = true, working = false } = {}) {
  const rows = NAV.map((n) => n.length === 1 ? `<div class="group">${n[0]}</div>`
    : `<div class="nav ${n[0] === on ? 'on' : ''}">${ic(n[1])}<span class="l">${n[2]}</span>${n[0] === 'assistant' && working ? chip('1', '#B14242', 'solid count') : (n[3] ? `<kbd>${n[3]}</kbd>` : '')}</div>`).join('');
  return `<aside class="side">
    <div class="brand">${logo(2)}<b>Hourglass</b><span class="ver">0.4.0</span></div>
    ${btn('New', { kind: 'primary', icon: 'plus', kbd: 'Ctrl N', cls: 'new' })}
    ${rows}
    <div class="side-foot">
      ${live ? `<div class="mini">${chip('Live', '#db8585', 'live')}<p class="t">Algorithms</p><p class="s">23 min left</p><div class="line" style="--p:81%"></div></div>` : ''}
      <div class="nav ${on === 'settings' ? 'on' : ''}">${ic('gear')}<span class="l">Settings</span><kbd>0</kbd></div>
      <div class="sync"><i></i><b style="font-weight:400">Synced</b><span>· mi@marobotic.dev</span></div>
    </div>
  </aside>`;
}
function tabbar(on, { working = false } = {}) {
  return `<nav class="tabbar">${TABS.map(([k, i, l]) => `<span class="tab ${k === on ? 'on' : ''}">${ic(i)}${l}${k === 'ask' && working ? '<i class="dot"></i>' : ''}</span>`).join('')}</nav>`;
}
const statusbar = `<div class="statusbar"><span class="num">9:37</span><span class="row" style="gap:0"><span class="sig"><i style="height:4px"></i><i style="height:6px"></i><i style="height:9px"></i><i style="height:12px"></i></span><span class="bat"><i></i></span></span></div>`;

function page(p) {
  const pushed = p.pushed ? 'pushed' : '';
  const title = p.phoneTitle ? `<span class="desk-only">${p.title}</span><span class="only-phone">${p.phoneTitle}</span>` : p.title;
  const back = p.back ? `<span class="btn subtle sq back ${p.back === 'phone' ? 'only-phone' : ''}">${ic('back')}</span>` : '';
  const head = p.head ?? `<header class="head">${back}<h1>${title}</h1>${p.ctx ? `<span class="ctx">${p.ctx}</span>` : ''}${p.mid ? `<div class="mid">${p.mid}</div>` : ''}<div class="acts">${p.acts || ''}${p.noGear ? '' : `<span class="btn subtle sq only-phone">${ic('gear')}</span>`}</div></header>`;
  return `<div class="frame">${statusbar}<div class="app ${pushed}">${sidebar(p.nav, p)}
    <main class="main">${head}${p.under || ''}<div class="page ${p.flush ? 'flush' : ''}">${p.body}</div>${p.fab ? `<span class="fab">${ic('plus')}</span>` : ''}${p.toast || ''}${tabbar(p.tab, p)}</main>
  </div><div class="homebar ${p.pushed ? 'bare' : ''}"></div>${p.overlay || ''}</div>`;
}
const doc = (body, { device = false, title = 'Hourglass' } = {}) => `<!doctype html><html lang="en" class="${device ? 'device' : ''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="../style.css"><style>.frame{position:relative}</style></head><body>${body}</body></html>`;

// ---------- Now ----------
function nowBody({ next = false } = {}) {
  const hero = next
    ? `<div class="card stripe hero" style="--c:#4A8B8B"><div class="row">${chip('Next', '#4A8B8B')}${chip('Tutorial')}<span class="next-count">in 1 h 23 min</span></div><h2>Linear Algebra</h2><div class="meta">11:00 – 12:00 · B204<span class="opt"> · Dr. Haddad</span></div><div class="acts">${btn('Open notes', { kind: 'primary', icon: 'note' })}${btn('Skip today', { icon: 'close' })}${sqbtn('more')}</div></div>`
    : `<div class="card stripe hero live"><div class="row">${chip('Live', '#db8585', 'live')}${chip('Lecture')}<span class="left">23 min left</span></div><h2>Algorithms</h2><div class="meta">08:00 – 10:00 · Room 4.12<span class="opt"> · Dr. Okafor</span></div><div class="acts">${btn('Notes for this class', { kind: 'primary', icon: 'note' })}${btn('Mark attended', { icon: 'check-square', cls: 'wide-only' })}${sqbtn('more')}</div><div class="line" style="--p:81%"></div></div>`;
  const notes = next
    ? `<div class="block">${sec('Last time', '· Mon 5 Oct')}<div class="notes2">${noteCard('eig')}${noteCard('matrix')}</div></div>`
    : `<div class="block">${sec('Notes for this session', '3')}<div class="notes2">${noteCard('dp')}${noteCard('sheet')}${noteCard('greedy')}</div></div>`;
  const later = next ? WEEK.filter((w) => w[0] === 2 && w[1] > 11) : WEEK.filter((w) => w[0] === 2 && w[1] > 9);
  const rows = `<div class="block">${sec('Coming up', `· ${later.length} more today`)}<div class="trows">${later.map((w) => `<div class="trow"><span class="tm">${hm(w[1])}</span><i class="sq" style="--c:${C[w[3]].c}"></i><span class="ti">${C[w[3]].name}${w[4] !== 'Event' && w[4] !== 'Lecture' ? ` <small>· ${w[4]}</small>` : ''}</span><span class="where">${C[w[3]].room}</span></div>`).join('')}</div></div>`;
  const time = `<div class="block">${sec('Running')}<div class="mini-rows"><div class="card tcard run">${ic('timer')}<span class="big">18:42</span><span class="l">Problem set 3</span><div class="line" style="--p:25%"></div></div><div class="card tcard">${ic('bell')}<span class="big">07:15</span><span class="l">Wake up · Mon–Fri</span></div></div></div>`;
  const clock = next ? '09:37' : '09:37';
  return `<div class="now-grid"><div class="now-main"><div><div class="date">Tuesday, 6 October</div><div class="clock">${clock}<small>:12</small></div></div>${hero}${notes}</div><div class="now-aside">${rows}${time}</div></div>`;
}
const nowPage = (o = {}) => ({
  nav: 'now', tab: 'now', title: 'Now', phoneTitle: `${logo(2)}Hourglass`, fab: true,
  ctx: o.next ? 'Linear Algebra · next at 11:00' : 'Algorithms · live until 10:00',
  acts: `${btn('Note for this class', { icon: 'note', cls: 'desk-only wide-only' })}${btn('Search', { kind: 'subtle', icon: 'search', kbd: 'Ctrl K', cls: 'desk-only' })}`,
  body: nowBody(o), live: !o.next, working: true,
});

// ---------- Schedule ----------
const H0 = 8, H1 = 18;
const blk = (w, { past = false, hover = false } = {}) => {
  const co = C[w[3]];
  const top = ((w[1] - H0) / (H1 - H0)) * 100, h = ((w[2] - w[1]) / (H1 - H0)) * 100;
  const extra = w[5] ? `<span class="x">${w[5]}</span>` : w[2] - w[1] >= 1.4 ? `<span class="rm">${co.room}</span>` : '';
  return `<div class="blk ${past ? 'past' : ''} ${hover ? 'hover' : ''}" style="--c:${co.c};top:calc(${top}% + 2px);height:calc(${h}% - 4px)"><b>${co.name}</b><span class="tm">${hm(w[1])}<em> – ${hm(w[2])}</em></span>${extra}</div>`;
};
const gutter = () => `<div class="gut">${Array.from({ length: H1 - H0 }, (_, i) => i ? `<span style="top:${(i / (H1 - H0)) * 100}%">${hm(H0 + i)}</span>` : '').join('')}</div>`;
const NOWPCT = ((9 + 37 / 60 - H0) / (H1 - H0)) * 100;
const DN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const daystrip = (on = 2) => `<div class="daystrip">${DN.map((d, i) => `<span class="${i + 1 === on ? 'on' : ''} ${WEEK.some((w) => w[0] === i + 1) ? 'dot' : ''}">${d.slice(0, 1)}<b>${5 + i}</b></span>`).join('')}</div>`;
function weekBody() {
  const cols = DN.map((d, i) => {
    const day = i + 1;
    const evs = WEEK.filter((w) => w[0] === day).map((w) => blk(w, { past: day < 2 || (day === 2 && w[2] <= 9.6), hover: day === 4 && w[1] === 14 })).join('');
    return `<div class="day ${day === 2 ? 'today' : ''}" style="--hr:10%">${evs}${day === 2 ? `<div class="nowline" style="top:${NOWPCT}%"></div>` : ''}</div>`;
  }).join('');
  const heads = DN.map((d, i) => `<div class="dh ${i === 1 ? 'today' : ''}"><span>${d}</span><b>${5 + i}</b></div>`).join('');
  return `${daystrip()}<div class="week"><div class="corner"></div>${heads}${gutter()}${cols}</div>`;
}
const schedHead = (mode) => ({
  mid: `${sqbtn('left', 'sm')}${btn('Today', { cls: 'sm' })}${sqbtn('right', 'sm')}<span class="ctx" style="margin-left:8px">${mode === 'Month' ? 'October 2026' : mode === 'Day' ? 'Tuesday, 6 October' : '<span class="rng-l">5 – 11 October 2026</span><span class="rng-s">5 – 11 Oct</span>'}</span>`,
  acts: `<span class="desk-only">${seg(['Day', 'Week', 'Month'], mode, 'sm')}</span>${btn('Attendance', { kind: 'subtle', icon: 'user-check', cls: 'desk-only wide-only' })}${btn('Event', { icon: 'plus', cls: 'desk-only' })}<span class="btn subtle sq only-phone">${ic('user-check')}</span>`,
});
const schedulePage = () => ({ nav: 'schedule', tab: 'schedule', title: 'Schedule', flush: true, fab: true, ...schedHead('Week'), body: weekBody() });
function dayBody() {
  const evs = WEEK.filter((w) => w[0] === 2).map((w) => blk(w, { past: w[2] <= 9.6 })).join('');
  const aside = `<div class="dayaside">
    <div class="block">${sec('Live now')}<div class="card stripe pad" style="--c:#B14242;display:grid;gap:8px"><div class="row">${chip('Live', '#db8585', 'live')}${chip('Lecture')}<span class="next-count">23 min left</span></div><b style="font-size:17px">Algorithms</b><span class="muted" style="font-size:13px">08:00 – 10:00 · Room 4.12 · Dr. Okafor</span></div></div>
    <div class="block">${sec('This day')}${seg(['Attended', 'Absent', 'Off'], 'Attended', 'full', '#4A8B8B')}</div>
    <div class="block">${sec('Notes for this session', '2')}${noteCard('dp')}${noteCard('sheet')}</div>
  </div>`;
  return `${daystrip()}<div class="dayaside-wrap"><div class="dayview">${gutter()}<div class="day today" style="--hr:10%;background-image:linear-gradient(var(--border) 1px, transparent 1px);background-size:100% 10%">${evs}<div class="nowline" style="top:${NOWPCT}%"></div></div></div>${aside}</div>`;
}
const scheduleDayPage = () => ({ nav: 'schedule', tab: 'schedule', title: 'Schedule', flush: true, fab: true, ...schedHead('Day'), body: dayBody() });
function monthBody() {
  const start = new Date(Date.UTC(2026, 8, 28));
  const cells = [];
  for (let i = 0; i < 35; i++) {
    const d = new Date(start.getTime() + i * 864e5);
    const dow = ((d.getUTCDay() + 6) % 7) + 1, dom = d.getUTCDate(), out = d.getUTCMonth() !== 9;
    let evs = WEEK.filter((w) => w[0] === dow && (w[5] ? dom === 9 && !out : true));
    if (dom === 22 && !out) evs = [[4, 8, 10, 'algo', 'Exam', 'Midterm'], ...evs.filter((w) => w[3] !== 'algo')];
    const shown = evs.slice(0, 2).map((w) => `<div class="ev" style="--c:${C[w[3]].c}"><span class="tm">${hm(w[1])}</span><span class="ell">${w[5] || C[w[3]].name}</span></div>`).join('');
    const more = evs.length > 2 ? `<div class="more">+${evs.length - 2} more</div>` : '';
    const dots = `<div class="dots">${evs.map((w) => `<i style="--c:${C[w[3]].c}"></i>`).join('')}</div>`;
    cells.push(`<div class="cell ${out ? 'out' : ''} ${dom === 6 && !out ? 'today' : ''}"><span class="d">${dom}</span>${shown}${more}${dots}</div>`);
  }
  return `<div class="month">${DN.map((d) => `<div class="wd">${d.toUpperCase()}</div>`).join('')}${cells.join('')}</div>`;
}
const scheduleMonthPage = () => ({ nav: 'schedule', tab: 'schedule', title: 'Schedule', flush: true, ...schedHead('Month'), body: monthBody() });

// ---------- Attendance ----------
function attBody() {
  const course = (k, att, held, rows) => {
    const pct = Math.round((att / held) * 100);
    const low = pct < 75;
    return `<div class="card stripe att" style="--c:${C[k].c}"><div class="att-top"><div style="display:grid;gap:4px;min-width:0"><h3><span class="ell">${C[k].name}</span>${chip(C[k].code)}</h3><span class="sub">${att} of ${held} attended${low ? ' · <span class="orange">under 75%</span>' : ''}</span></div><div class="rate ${low ? 'orange' : ''}">${pct}%</div><div class="meter" style="--p:${pct}%;${low ? '--lc:var(--orange)' : '--lc:var(--teal)'}"></div></div>
      ${rows.map(([d, kind, m]) => `<div class="srow"><span class="d">${d}</span><span class="k">${kind}</span>${seg(['Attended', 'Absent', 'Off'], m, 'sm', m === 'Attended' ? '#4A8B8B' : m === 'Absent' ? '#B14242' : '#969696')}</div>`).join('')}</div>`;
  };
  return `<div class="att-grid">
    ${course('algo', 9, 10, [['Tue 6 Oct', 'Lecture · 08:00', 'Attended'], ['Fri 2 Oct', 'Tutorial · 12:00', 'Attended'], ['Thu 1 Oct', 'Lecture · 08:00', 'Absent'], ['Tue 29 Sep', 'Lecture · 08:00', 'Attended']])}
    ${course('lin', 7, 10, [['Mon 5 Oct', 'Lecture · 10:00', 'Attended'], ['Fri 2 Oct', 'Exam · 09:00', 'Off'], ['Wed 30 Sep', 'Lecture · 10:00', 'Absent'], ['Tue 29 Sep', 'Tutorial · 11:00', 'Absent']])}
    ${course('print', 4, 4, [['Tue 29 Sep', 'Studio · 13:30', 'Attended'], ['Tue 22 Sep', 'Studio · 13:30', 'Attended']])}
    ${course('hist', 5, 6, [['Mon 5 Oct', 'Lecture · 14:00', 'Attended'], ['Wed 30 Sep', 'Lecture · 14:00', 'Attended']])}
  </div>`;
}
const attendancePage = () => ({ nav: 'attendance', tab: 'schedule', title: 'Attendance', back: 'phone', pushed: true, ctx: '25 of 30 sessions this term · 83%', acts: btn('This term', { kind: 'subtle', icon: 'calendar', cls: 'desk-only' }), body: attBody() });

// ---------- Notes ----------
const folderRow = (name, n, { c, icon, on } = {}) => `<div class="folder ${on ? 'on' : ''}">${c ? `<i class="sq" style="--c:${c}"></i>` : ic(icon)}<span class="ell">${name}</span><span class="n">${n}</span></div>`;
function notesBody({ menu = false } = {}) {
  const ctxMenu = menu ? `<div class="menu desk-only" style="top:44px;right:-8px"><div class="mt">Eigenvalues</div><div class="mi">${ic('edit')}Open</div><div class="mi hv">${ic('pin')}Pin to every session</div><div class="mi">${ic('move')}Move to course…</div><div class="mi">${ic('share')}Share</div><div class="mi">${ic('history')}Versions</div><div class="ms"></div><div class="mi danger">${ic('trash')}Delete</div></div>` : '';
  return `<div class="phone-seg">${seg(['Notes', 'Drive'], 'Notes', 'full')}</div><div class="notes-wrap">
    <div class="folders">
      <div class="group">NOTES</div>${folderRow('All notes', 24, { icon: 'note', on: true })}${folderRow('Pinned', 3, { icon: 'pin' })}${folderRow('Inbox', 2, { icon: 'inbox' })}
      <div class="group">COURSES</div>${folderRow('Algorithms', 8, { c: C.algo.c })}${folderRow('Linear Algebra', 6, { c: C.lin.c })}${folderRow('Printmaking', 3, { c: C.print.c })}${folderRow('Physics Lab', 2, { c: C.phys.c })}${folderRow('Modern History', 3, { c: C.hist.c })}
    </div>
    <div class="masonry-wrap">
      <div class="folder-strip"><span class="fchip on">All</span><span class="fchip">${ic('pin')}Pinned</span><span class="fchip"><i class="sq" style="--c:${C.algo.c}"></i>Algorithms</span><span class="fchip"><i class="sq" style="--c:${C.lin.c}"></i>Linear Algebra</span><span class="fchip"><i class="sq" style="--c:${C.print.c}"></i>Printmaking</span></div>
      <div class="masonry">
        ${noteCard('dp', { lines: 4 })}${noteCard('eig', { lines: 4, hover: menu, menu: ctxMenu })}${noteCard('shop')}${noteCard('sheet', { lines: 2 })}${noteCard('lino', { lines: 6 })}${noteCard('lab', { lines: 4 })}${noteCard('essay', { lines: 4 })}${noteCard('greedy', { lines: 2 })}${noteCard('read', { lines: 4 })}${noteCard('matrix', { lines: 4 })}
      </div>
    </div></div>`;
}
const notesPage = (o = {}) => ({ nav: 'notes', tab: 'notes', title: 'Notes', flush: true, fab: true, mid: `${field('Search notes', { ph: true, icon: 'search' }).replace('class="field', 'style="width:280px" class="field')}`, acts: `${btn('Note', { kind: 'primary', icon: 'plus', cls: 'desk-only' })}<span class="btn subtle sq only-phone">${ic('search')}</span>`, body: notesBody(o) });

function noteBody() {
  const bar = `<div class="note-bar"><span class="pick">Noto Sans<i class="caret">${ic('down')}</i></span><span class="pick phone-hide">16<i class="caret">${ic('down')}</i></span><i class="sep"></i>${['bold', 'italic', 'underline', 'strike'].map((k, i) => `<span class="btn sm sq ${i === 0 ? 'on' : ''}">${ic(k)}</span>`).join('')}<i class="sep"></i>${['heading', 'list-ul', 'list-ol', 'check-square'].map((k) => `<span class="btn sm sq ${k === 'list-ol' || k === 'heading' ? 'phone-hide' : ''}">${ic(k)}</span>`).join('')}<i class="sep wide-only"></i><span class="btn sm sq wide-only">${ic('image')}</span><span class="btn sm sq wide-only">${ic('clip')}</span></div>`;
  const aside = `<aside class="note-aside">
    <div class="block">${sec('This session')}<div class="card stripe pad" style="--c:#B14242;display:grid;gap:4px"><b>Algorithms · Lecture</b><span class="muted" style="font-size:13px">Tue 6 Oct · 08:00 – 10:00</span><span class="muted" style="font-size:13px">Room 4.12</span></div></div>
    <div class="block">${sec('Same course')}${noteCard('sheet')}${noteCard('greedy')}</div>
    <div class="block">${sec('Attached', '2')}<div class="trows"><div class="trow" style="grid-template-columns:20px minmax(0,1fr) auto">${ic('file-pdf')}<span class="ti">Week 5 slides.pdf</span><span class="where">4.2 MB</span></div><div class="trow" style="grid-template-columns:20px minmax(0,1fr) auto">${ic('file-code')}<span class="ti">knapsack.py</span><span class="where">2 KB</span></div></div></div>
  </aside>`;
  return `${bar}<div class="note-wrap"><div class="note-scroll"><article class="note-doc">
    <h1>Dynamic programming</h1>
    <div class="note-meta">${chip('Algorithms', '#db8585')}<span class="opt">Tue 6 Oct</span><span class="dotsep opt"></span><span>Edited 2 min ago</span><span class="dotsep"></span><span>${ic('history')} 4 versions</span></div>
    <div class="prose">
      <p>Two ideas make a problem a DP problem: <b>overlapping subproblems</b> and <b>optimal substructure</b>. If both hold, solve each subproblem once and <u>reuse the answer</u>.</p>
      <h2>Memoisation vs tabulation</h2>
      <ul><li>Top-down: recursion plus a cache. Easy to write, only solves what it needs.</li><li>Bottom-up: fill a table in order. No recursion depth, easy to save memory.</li></ul>
      <h2>0/1 knapsack</h2>
      <p>Rows are items, columns are capacity. Each cell takes the better of <mark>skipping the item</mark> or taking it and looking up the remaining capacity.</p>
      <pre>best[i][w] = max(best[i-1][w], v[i] + best[i-1][w - wt[i]])</pre>
      <ul class="todos"><li class="done"><i class="box on"></i><span>Redo the 4-item example from the board</span></li><li><i class="box"></i><span>Problem set 3, questions 2 and 5</span></li><li><i class="box"></i><span>Ask about space-optimised version in the tutorial</span></li></ul>
    </div>
  </article></div>${aside}</div>`;
}
const notePage = () => ({ nav: 'notes', tab: 'notes', title: 'Dynamic programming', back: true, pushed: true, flush: true, noGear: true, ctx: 'Algorithms · Tue 6 Oct', acts: `${btn('Pin', { kind: 'subtle', icon: 'pin', cls: 'desk-only' })}${btn('Versions', { kind: 'subtle', icon: 'history', cls: 'desk-only wide-only' })}${btn('Share', { kind: 'subtle', icon: 'share', cls: 'desk-only wide-only' })}${sqbtn('more', 'subtle')}`, body: noteBody() });

// ---------- Drive ----------
const FILES = [
  ['folder', 'Past papers', '12 files', 'Mon 5 Oct, 18:20', 'dir'], ['folder', 'Problem sets', '3 files', 'Fri 2 Oct, 11:02', 'dir'],
  ['file-pdf', 'Week 5 slides.pdf', '4.2 MB', 'Today, 08:04'], ['file-image', 'Whiteboard 6 Oct.jpg', '2.8 MB', 'Today, 09:31', '', true],
  ['file-code', 'knapsack.py', '2 KB', 'Today, 09:12'], ['file-pdf', 'Problem set 3.pdf', '310 KB', 'Thu 1 Oct, 16:40'],
  ['file-text', 'Reading notes.md', '9 KB', 'Wed 30 Sep, 21:15'], ['file-zip', 'Lab 1 data.zip', '18.6 MB', 'Tue 22 Sep, 14:05'],
];
function driveBody({ drop = false, uploads = false } = {}) {
  const rows = FILES.map(([i, n, s, m, dir, sel]) => `<div class="frow ${sel ? 'sel' : ''}">${ic(i, dir)}<span class="nm"><span>${n}</span>${n === 'Problem sets' ? `<i class="ic teal" style="font-size:12px">&#x${G.sync};</i>` : ''}</span><span class="sz">${s}</span><span class="md">${m}</span><span class="more">${ic('more')}</span></div>`).join('');
  const preview = `<aside class="drive-preview"><div class="thumb"><svg width="100%" height="100%" viewBox="0 0 160 120" preserveAspectRatio="none"><rect width="160" height="120" fill="#e9e6df"/><g stroke="#2b2b2b" stroke-width="1.2" fill="none"><path d="M18 22h46M18 30h32"/><rect x="18" y="44" width="72" height="44"/><path d="M18 59h72M18 74h72M42 44v44M66 44v44"/><path d="M104 50c10-16 26-16 36 0" /><path d="M100 92h46"/></g><g fill="#B14242"><rect x="70" y="80" width="18" height="6" opacity=".6"/></g></svg></div>
    <div style="display:grid;gap:4px"><b>Whiteboard 6 Oct.jpg</b><span class="muted" style="font-size:12px">Algorithms</span></div>
    <dl class="kv"><dt>Size</dt><dd>2.8 MB</dd><dt>Modified</dt><dd>Today, 09:31</dd><dt>Kind</dt><dd>JPEG image</dd><dt>Shared</dt><dd class="teal">Link on</dd></dl>
    <div class="row wrap">${btn('Open', { kind: 'primary', icon: 'external' })}${btn('Share', { icon: 'link' })}${btn('', { icon: 'download', cls: 'sq' })}</div></aside>`;
  return `<div class="phone-seg">${seg(['Notes', 'Drive'], 'Drive', 'full')}</div><div class="drive-split"><div class="page" style="display:grid;gap:20px;align-content:start;min-width:0">
    <div class="drive-top"><div class="crumbs desk-only"><span>Drive</span><i>${ic('right')}</i><b>Algorithms</b></div><span class="grow"></span><div class="usage"><span class="row"><span class="grow">Storage</span><span class="num">2.1 / 10 GB</span></span><div class="meter" style="--p:21%"></div></div></div>
    <div class="ftable"><div class="frow hd"><span></span><span>Name</span><span>Size</span><span class="md">Modified</span><span></span></div>${rows}</div>
  </div>${preview}</div>
  ${drop ? `<div class="droptint"><div class="dropcard">${ic('upload')}<b>Drop to upload</b><span>Files go into Algorithms</span></div></div>` : ''}
  ${uploads ? `<div class="uploads"><div class="uh"><b class="grow">Uploading 2 of 3</b><span class="muted num">14 s left</span><span class="btn sm sq subtle">${ic('close')}</span></div>
    <div class="ur"><span class="row"><span class="grow ell">Lecture recording 6 Oct.mp4</span><span class="muted num">62%</span></span><div class="line" style="--p:62%"></div></div>
    <div class="ur"><span class="row"><span class="grow ell">Problem set 3 answers.pdf</span><span class="muted num">18%</span></span><div class="line" style="--p:18%"></div></div>
    <div class="ur"><span class="row"><span class="grow ell">Board photo 2.jpg</span><span class="teal">${ic('check')}</span></span></div></div>` : ''}`;
}
const drivePage = (o = {}) => ({ nav: 'drive', tab: 'notes', title: 'Drive', flush: true, acts: `${btn('Sync folder', { kind: 'subtle', icon: 'sync', cls: 'desk-only wide-only' })}${btn('New folder', { icon: 'folder', cls: 'desk-only' })}${btn('Upload', { kind: 'primary', icon: 'upload' })}`, body: driveBody(o) });

// ---------- Time ----------
const timeSeg = (on) => `<div class="time-seg">${seg(['Alarms', 'Reminders', 'Timers', 'World'], on, 'full')}</div>`;
function alarmsBody() {
  const row = (tm, ap, lbl, sub, d, on, stripe) => `<div class="card ${stripe ? 'stripe' : ''} arow ${on ? '' : 'off'}" ${stripe ? `style="--c:${stripe}"` : ''}><span class="tm">${tm}</span><span class="lb"><b>${lbl}</b><span>${sub}</span></span>${d ? days(d, on ? '' : 'dim') : ''}${sw(on)}</div>`;
  const form = `<div class="card form side-form wide-only"><h3>New alarm</h3>${seg(['At a time', 'Before a class'], 'At a time', 'full')}<div class="r2">${field('06:45', { label: 'Time' })}${field('Morning run', { label: 'Label' })}</div><label class="label">Repeat${days([1, 3, 5])}</label><label class="label">Sound${field('Sunrise', { caret: true })}</label><div class="foot">${btn('Add alarm', { kind: 'primary', icon: 'plus' })}</div></div>`;
  return `<div class="time-wrap split">${timeSeg('Alarms')}${form}<div class="main-list"><div class="block">${sec('Alarms', '· 3 on')}
    <div class="stack">${row('07:15', '', 'Wake up', 'Weekdays · Sunrise', [1, 2, 3, 4, 5], true)}${row('−15<small>min</small>', '', 'Before Algorithms', 'Every class', null, true, C.algo.c)}${row('−10<small>min</small>', '', 'Before Physics Lab', 'Every lab', null, true, C.phys.c)}${row('09:00', '', 'Gym', 'Saturdays', [6], false)}${row('22:30', '', 'Wind down', 'Every day', [1, 2, 3, 4, 5, 6, 7], false)}</div></div></div></div>`;
}
const alarmsPage = () => ({ nav: 'alarms', tab: 'time', title: 'Alarms', ctx: 'Next: Algorithms tutorial reminder, Fri 11:45', acts: btn('Alarm', { kind: 'primary', icon: 'plus' }), body: alarmsBody() });

function remindersBody() {
  const r = (t, sub, cls = '', done = false) => `<div class="rrow ${done ? 'done' : ''}"><i class="box ${done ? 'on' : ''}"></i><span class="lb"><b>${t}</b><span class="${cls}">${sub}</span></span><span class="btn sm sq subtle">${ic('more')}</span></div>`;
  const form = `<div class="card form side-form"><h3 class="desk-only">New reminder</h3>${field('Remind me to…', { ph: true })}<div class="r2">${field('18:00', { label: 'Time' })}<label class="label">Repeat${seg(['Once', 'Repeats'], 'Once', 'full')}</label></div><div class="row"><small class="faint grow" style="font-size:12px">No day: today, or tomorrow if 18:00 has passed.</small>${btn('Add', { kind: 'primary', icon: 'reminder' })}</div></div>`;
  return `<div class="time-wrap split">${timeSeg('Reminders')}${form}<div class="main-list">
    <div class="block">${sec('Overdue', '1')}<div class="card">${r('Submit lab 2 report', 'Yesterday, 23:59 · 14 h late', 'orange')}</div></div>
    <div class="block">${sec('Today')}<div class="card">${r('Call mom', '18:00')}${r('Buy lino ink', '17:30')}</div></div>
    <div class="block">${sec('Later')}<div class="card">${r('Return library books', 'Thu 8 Oct, 12:00')}${r('Water the plants', 'Mon, Thu · 08:30')}${r('Pay rent', 'Thu 1 Oct, done', '', true)}</div></div>
  </div></div>`;
}
const remindersPage = () => ({ nav: 'reminders', tab: 'time', title: 'Reminders', ctx: '1 overdue · 2 today', acts: btn('Alarms', { kind: 'subtle', icon: 'bell', cls: 'desk-only' }), body: remindersBody() });

function perim(p) { // square progress along the card edge, clockwise from the top-left
  const q = (a) => Math.max(0, Math.min(25, p - a)) * 4;
  return `<i class="perim" style="left:-1px;top:-1px;height:2px;width:calc(${q(0)}% + 2px)"></i>${q(25) ? `<i class="perim" style="right:-1px;top:-1px;width:2px;height:calc(${q(25)}% + 2px)"></i>` : ''}`;
}
function timersBody() {
  const t = (lbl, big, of, p, paused = false) => `<div class="card timer ${paused ? 'paused' : ''}">${paused ? '' : perim(p)}<div class="top"><b class="grow ell">${lbl}</b>${paused ? chip('Paused') : chip('Running', '#db8585', 'live')}${sqbtn('trash', 'subtle sm')}</div><div class="big">${big}<small>of ${of}</small></div><div class="acts">${paused ? btn('Resume', { kind: 'primary', icon: 'play' }) : btn('Pause', { icon: 'pause' })}${btn('+1 min')}${btn('Reset', { kind: 'subtle', icon: 'undo' })}</div></div>`;
  return `<div class="time-wrap wideworld" style="max-width:1280px">${timeSeg('Timers')}<div class="block">${sec('Start')}<div class="quick"><span class="qchip">5 min</span><span class="qchip">10 min</span><span class="qchip on">25 min</span><span class="qchip">50 min</span><span class="qchip">${ic('plus')} Custom</span></div></div>
    <div class="block">${sec('Running', '2')}<div class="timers">${t('Problem set 3', '18:42', '25:00', 34)}${t('Tea', '03:10', '05:00', 0, true)}</div></div></div>`;
}
const timersPage = () => ({ nav: 'timers', tab: 'time', title: 'Timers', ctx: 'Problem set 3 ends at 09:56', acts: btn('Timer', { kind: 'primary', icon: 'plus' }), body: timersBody() });

const CITIES = [
  ['Cairo', 'Africa/Cairo', 'App time', '09:37', 'Tue', 'sun', true, 40],
  ['London', 'Europe/London', '−2 h', '07:37', 'Tue', 'sun', false, 32],
  ['New York', 'America/New_York', '−7 h', '02:37', 'Tue', 'moon', false, 11],
  ['Tokyo', 'Asia/Tokyo', '+6 h', '15:37', 'Tue', 'sun', false, 65],
  ['Dubai', 'Asia/Dubai', '+1 h', '10:37', 'Tue', 'sun', false, 44],
  ['São Paulo', 'America/Sao_Paulo', '−6 h', '03:37', 'Tue', 'moon', false, 15],
];
function worldBody() {
  const list = `<div class="card cities city-list-only">${CITIES.map(([n, z, off, tm, d, glyph, home]) => `<div class="city ${home ? 'home' : ''}">${ic(glyph, glyph === 'sun' ? 'sun' : '')}<span class="nm"><b>${n}${home ? chip('App time', '#db8585') : ''}</b><span>${home ? z : `${off} · ${z}`}</span></span><span class="tm">${tm}<small>${d} 6 Oct</small></span></div>`).join('')}</div>`;
  const grid = `<div class="city-grid city-grid-only">${CITIES.map(([n, z, off, tm, d, glyph, home, pos]) => `<div class="card cityc ${home ? 'home stripe' : ''}"><div class="nm">${ic(glyph, glyph === 'sun' ? 'gold' : 'muted')}<span class="grow ell">${n}</span>${home ? chip('App time', '#db8585') : `<span class="muted" style="font-weight:400;font-size:13px">${off}</span>`}</div><div class="tm">${tm}</div><div class="dayline"><i style="left:${pos}%"></i></div><div class="sub"><span>${z}</span><span>${d} 6 Oct</span></div></div>`).join('')}</div>`;
  return `<div class="time-wrap wideworld">${timeSeg('World')}<div class="row">${field('Add a city or time zone', { ph: true, icon: 'search', cls: 'grow' })}</div>${list}${grid}</div>`;
}
const worldPage = () => ({ nav: 'world', tab: 'time', title: 'World clock', ctx: 'Your time is Cairo', acts: btn('App time', { kind: 'subtle', icon: 'globe', cls: 'desk-only' }), body: worldBody() });

// ---------- Assistant ----------
const chatHeadAct = `<span class="usage-chip desk-only wide-only">12k tokens · 34% usage</span>`;
function chatBody({ empty = false } = {}) {
  const foot = `<div class="cfoot"><span class="acct grow">Anthropic · your key</span><span class="pk">Haiku 5.5 · Medium<i class="caret">${ic('down')}</i></span><i class="vs"></i><span class="pk">Auto<i class="caret">${ic('down')}</i></span></div>`;
  if (empty) {
    return `<div class="chat"><div class="empty-chat">${logo(6)}<h2>Ask Hourglass to do it for you</h2><p>It can read and change your schedule, notes, alarms and timers.</p>
      <div class="sugg">${btn('Wake me at 7:30 on weekdays', { icon: 'bell' })}${btn('What do I have tomorrow?', { icon: 'week' })}${btn('Tidy my latest note', { icon: 'note' })}${btn('Start a 25 minute timer', { icon: 'timer' })}</div></div>
      <div class="composer-wrap"><div class="composer-in"><div class="composer"><span class="att">${ic('plus')}</span><span class="ph">Ask Hourglass…</span><span class="send">${ic('arrow-up')}</span></div>${foot}</div></div></div>`;
  }
  return `<div class="chat"><div class="msgs"><div class="msgs-in">
    <div class="ub">Wake me at 7:30 on weekdays, and move my Thursday lab to 2 PM</div>
    <div class="tool"><span class="st ok">${ic('check')}</span><span><b>Set an alarm</b> <span class="s">07:30 · Mon–Fri</span></span></div>
    <div class="tool"><span class="st ok">${ic('check')}</span><span><b>Read your schedule</b> <span class="s">this week</span></span><span class="det">└ 9 sessions, 1 lab on Thursday</span></div>
    <div class="think">${ic('right')} Thought for 4 s</div>
    <div class="reply">Done. Your alarm rings at <b>7:30 every weekday</b>. Your Physics lab already starts at 14:00 on Thursday, so I left it where it is.</div>
    <div class="card stripe rcard"><span class="big">07:30</span><span class="l">Wake up · Mon–Fri</span>${btn('Open', { cls: 'sm' })}</div>
    <div class="hacts"><span>${ic('copy')}Copy</span><span>${ic('quote')}Quote</span><span>${ic('refresh')}Retry</span><span>${ic('undo')}Undo</span></div>
    <div class="ub">Then remind me 15 minutes before it</div>
    <div class="qtag">Queued · after this reply ${btn('Send now')}</div>
    <div class="tool"><span class="st run">${ic('star')}</span><span><b>Add a lead alarm</b> <span class="s">Physics Lab · 15 min before</span></span></div>
    <div class="status">${ic('star')}Setting an alarm… <span>6 s · 1.2k tokens</span></div>
  </div></div>
  <div class="composer-wrap"><div class="composer-in"><div class="composer"><span class="att">${ic('plus')}</span><span class="ph">Ask Hourglass…</span><span class="send stop">${ic('stop')}</span></div>${foot}</div></div></div>`;
}
const assistantPage = (o = {}) => ({
  nav: 'assistant', tab: 'ask', title: 'Assistant', flush: true, working: !o.empty,
  head: `<header class="head"><div class="chat-head">${ic('spark', 'spark')}<span class="who"><b>Assistant</b><span><i class="prov">Anthropic · </i>Haiku 5.5 · medium</span></span></div><div class="acts">${o.empty ? '' : chatHeadAct}${o.empty ? chip('Idle') : chip('Working', '#db8585')}${sqbtn('more', 'subtle')}</div></header>`,
  body: chatBody(o),
});

// ---------- Settings ----------
function settingsBody() {
  const set = (l, s, c, wide = false) => `<div class="set"><span class="l"><b>${l}</b>${s ? `<small>${s}</small>` : ''}</span><span class="c ${wide ? 'wide' : ''}">${c}</span></div>`;
  const idx = ['Account', 'Sync', 'Appearance', 'Time', 'Alarms', 'Assistant', 'Use with AI', 'About'];
  return `<div class="set-wrap"><nav class="set-index">${idx.map((s, i) => `<div class="folder ${i === 0 ? 'on' : ''}">${s}</div>`).join('')}</nav><div class="set-col">
    <section class="set-sec">${sec('Account')}${set('mi@marobotic.dev', 'Signed in on 3 devices', btn('Sign out', { kind: 'subtle' }))}</section>
    <section class="set-sec">${sec('Sync')}${set('<span class="row"><i class="sq" style="--c:var(--teal);width:7px;height:7px"></i>Synced</span>', 'Last synced 12 s ago<span class="host"><i> · </i>hourglass.marobotic.dev</span>', btn('Sync now', { icon: 'sync' }))}</section>
    <section class="set-sec">${sec('Appearance')}${set('Theme', 'Follows Omarchy on Linux', seg(['Dark', 'Light'], 'Dark', 'sm'))}</section>
    <section class="set-sec">${sec('Time')}${set('Time zone', 'Events keep their own zone; this is how they show', field('Africa/Cairo', { caret: true }).replace('class="field', 'style="width:200px" class="field'), true)}${set('Clock', '', seg(['12-hour', '24-hour'], '24-hour', 'sm'))}${set('Week starts on', '', seg(['Sat', 'Sun', 'Mon'], 'Mon', 'sm'))}</section>
    <section class="set-sec">${sec('Alarms')}${set('Lecture reminders', 'Rings before every lecture, on all your devices', seg(['Off', '10', '15', '30'], '15', 'sm'), true)}
      <div class="tones">${[['Sunrise', 'Built in', true], ['Bell tower', 'Built in'], ['Marimba', 'Built in'], ['Lo-fi wake', 'Uploaded']].map(([n, k, on]) => `<div class="tone ${on ? 'on' : ''}"><i class="radio ${on ? 'on' : ''}"></i><span>${n}</span><small>${k}</small></div>`).join('')}</div>
      ${set('Alarm sound', 'Off: alarms still show a notification', sw(true))}${set('Test ring', 'Rings this device in 5 seconds', btn('Ring now', { icon: 'bell' }))}</section>
    <section class="set-sec">${sec('Assistant')}${set('Engine', 'Who answers. Keys are stored encrypted on your account', field('Anthropic · your key', { caret: true }).replace('class="field', 'style="width:220px" class="field'), true)}${set('Usage', '34% of this week', btn('Details', { kind: 'subtle', icon: 'external' }))}</section>
    <section class="set-sec">${sec('Use with AI')}${set('Your AI link', 'Add it as an MCP connector in any AI. Keep it to yourself', `<code class="link">…/mcp/8f3a1c2e…</code>${btn('', { icon: 'copy', cls: 'sq' })}`, true)}</section>
    <section class="set-sec">${sec('About')}${set('Hourglass 0.4.0', 'Up to date', btn('Check for updates', { kind: 'subtle' }))}</section>
  </div></div>`;
}
const settingsPage = () => ({ nav: 'settings', tab: 'now', title: 'Settings', back: 'phone', pushed: true, noGear: true, body: settingsBody() });

// ---------- whole window ----------
const signinBody = () => `<div class="center">${logo(6)}<div class="wordmark">Hourglass</div><p class="tagline">Your schedule and notes, on every device.</p>
  <div class="card signin">${seg(['Sign in', 'Create account'], 'Sign in', 'full')}${field('mi@marobotic.dev', { label: 'Email' })}${field('••••••••••••', { label: 'Password', cls: 'focus' })}${btn('Sign in', { kind: 'primary' })}<div class="foot">${btn('Forgot password?', { kind: 'subtle', cls: 'sm' })}</div></div></div>`;
const bare = (body) => `<div class="frame">${statusbar}<div style="flex:1;min-height:0">${body}</div><div class="homebar bare"></div></div>`;

// ---------- overlays ----------
const scrim = (cls = '') => `<div class="scrim ${cls}"></div>`;
const sheet = ({ title, sub, body, foot, cls = '', layer = 'sheetish' }) => `${scrim()}<div class="layer ${layer}"><div class="sheet ${cls}"><i class="handle"></i><div class="sh"><div style="min-width:0"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><span class="btn subtle sq x">${ic('close')}</span></div><div class="sb">${body}</div>${foot ? `<div class="sf">${foot}</div>` : ''}</div></div>`;

const sessionSheet = sheet({
  title: 'Physics Lab', sub: 'Thu 8 Oct · 14:00 – 17:00 · Lab 3',
  body: `<div class="row">${chip('Lab', '#D66E36')}${chip('PH150')}<span class="muted row" style="font-size:13px;margin-left:8px">${ic('person')}Dr. Mensah</span></div>${sec('This day')}<div class="row wrap">${seg(['Attended', 'Absent', 'Off'], '', 'sm')}<small class="faint" style="font-size:12px">Mark it once the lab is on.</small></div>${sec('Notes for this session', '1')}${noteCard('lab')}${btn('Add another note', { kind: 'primary', icon: 'note', cls: 'self' })}`,
  foot: `${btn('Skip this date', { kind: 'danger', icon: 'close' })}<span class="grow"></span>${btn('Edit event', { icon: 'edit' })}${btn('Close', { cls: 'desk-only' })}`,
});
const eventSheet = sheet({
  title: 'Edit event', sub: 'Physics Lab · every Thursday',
  body: `<div class="r2">${field('Physics Lab', { label: 'Title' })}<label class="label">Course${field(`<span class="row"><i class="sq" style="--c:#D66E36"></i>Physics Lab</span>`, { caret: true })}</label></div>
    <label class="label">Kind${seg(['Lecture', 'Lab', 'Tutorial', 'Exam', 'Event'], 'Lab', 'full sm')}</label>
    <div class="r3">${field('Thu 8 Oct', { label: 'Date' })}${field('14:00', { label: 'Starts' })}${field('17:00', { label: 'Ends' })}</div>
    <div class="r2 stack-phone"><label class="label">Repeats${seg(['Once', 'Weekly', 'Monthly'], 'Weekly', 'full sm')}</label><label class="label">On${days([4])}</label></div>
    <div class="r2">${field('Lab 3', { label: 'Room' })}${field('12 Dec 2026', { label: 'Until' })}</div>`,
  foot: `${btn('Delete', { kind: 'danger', icon: 'trash' })}<span class="grow"></span>${btn('Cancel', { kind: 'subtle' })}${btn('Save', { kind: 'primary' })}`,
});
const courseSheet = sheet({
  title: 'Course', sub: 'Printmaking · AR118',
  body: `<div class="r2 stack-phone">${field('Printmaking', { label: 'Name' })}${field('AR118', { label: 'Code' })}</div><label class="label">Colour<span class="swatches">${['#B14242', '#D66E36', '#F0BE66', '#4A8B8B', '#7E6BAF', '#5B8C4A', '#C2587E', '#8A8A8A'].map((c) => `<i style="--c:${c}" class="${c === '#5B8C4A' ? 'on' : ''}"></i>`).join('')}</span></label>
    <div class="r2 stack-phone">${field('NB631', { label: 'Room' })}${field('Ms. Lindqvist', { label: 'Teacher' })}</div>
    ${sec('Weekly times')}<div class="trows"><div class="trow" style="grid-template-columns:80px minmax(0,1fr) auto"><span class="tm">Tue</span><span class="ti">13:30 – 16:00 · Studio</span><span class="btn sm sq subtle">${ic('close')}</span></div></div>
    <div class="row">${btn('Add a time', { icon: 'plus', cls: 'sm' })}<span class="grow"></span><span class="row muted" style="font-size:13px">Archived ${sw(false)}</span></div>`,
  foot: `${btn('Delete course', { kind: 'danger', icon: 'trash' })}<span class="grow"></span>${btn('Cancel', { kind: 'subtle' })}${btn('Save', { kind: 'primary' })}`,
});
const alarmSheet = sheet({
  title: 'New alarm', sub: 'Rings on your 3 devices',
  body: `${seg(['At a time', 'Before a class'], 'Before a class', 'full')}<div class="r2"><label class="label">Minutes before${field('15')}</label><label class="label">Class${field(`<span class="row"><i class="sq" style="--c:#D66E36"></i>Physics Lab</span>`, { caret: true })}</label></div>${field('Before Physics Lab', { label: 'Label' })}<label class="label">Sound${field('Sunrise', { caret: true })}</label><small class="faint" style="font-size:12px">Next ring: Thursday 8 October at 13:45.</small>`,
  foot: `<span class="grow"></span>${btn('Cancel', { kind: 'subtle' })}${btn('Add alarm', { kind: 'primary', icon: 'bell' })}`,
});
const versionsSheet = sheet({
  title: 'Versions', sub: 'Dynamic programming · 4 versions', cls: 'wide',
  body: `<div class="ver-split"><div class="list">
      <div class="ver-row"><span class="when">Today 09:35</span><span class="why">Now</span></div>
      <div class="ver-row on"><span class="when">Today 08:52</span><span class="why">Before editing</span></div>
      <div class="ver-row"><span class="when">Thu 1 Oct 10:04</span><span class="why">Phone, kept from a conflict</span></div>
      <div class="ver-row"><span class="when">Thu 1 Oct 08:31</span><span class="why">Before editing</span></div></div>
    <div class="pv"><b style="color:var(--fg);font-family:var(--mono);font-size:13px">Today 08:52</b><p>Two ideas make a problem a DP problem: overlapping subproblems and optimal substructure.</p><p><del>Top-down is always faster.</del> <ins>Top-down: recursion plus a cache.</ins></p><p>Rows are items, columns are capacity.</p></div></div>`,
  foot: `<span class="grow"></span>${btn('Save a copy', { kind: 'subtle', icon: 'copy' })}${btn('Restore this version', { kind: 'primary', icon: 'history' })}`,
});
const confirmSheet = `${scrim()}<div class="layer"><div class="sheet confirm"><div class="sh"><h2>Delete this note?</h2></div><div class="sb"><p class="msg">“Dynamic programming” and its 3 older versions are removed from every device. Its pictures stay in Drive.</p></div><div class="sf"><span class="grow"></span>${btn('Keep note', { kind: 'subtle' })}${btn('Delete note', { kind: 'primary', icon: 'trash' })}</div></div></div>`;
const ringOverlay = (timer = false) => `${scrim('ring-scrim')}<div class="layer"><div class="ring-card">${logo(5)}<div class="kind">${timer ? "TIME'S UP" : 'ALARM'}</div><div class="lab">${timer ? 'Problem set 3' : 'Before Algorithms'}</div><div class="sub">${timer ? '25 min timer' : 'Lecture at 08:00 · Room 4.12'}</div><div class="clk">${timer ? '00:00' : '07:45'}</div>${btn('Snooze 5 min')}${btn('Dismiss', { kind: 'primary' })}</div></div>`;
const paletteOverlay = `${scrim()}<div class="layer top"><div class="palette"><div class="pin">${ic('search')}<span>dyn</span><i class="cur"></i></div><div class="pl">
  <div class="pi kb">${ic('note')}<span class="t"><em>Dyn</em>amic programming</span><span class="h">Algorithms · Today</span></div>
  <div class="pi">${ic('note')}<span class="t">Greedy vs DP: <em>dyn</em>amic table…</span><span class="h">Algorithms · Thu</span></div>
  <div class="pg">GO TO</div><div class="pi">${ic('week')}<span class="t">Schedule</span><span class="h">2</span></div><div class="pi">${ic('drive')}<span class="t">Drive</span><span class="h">8</span></div>
  <div class="pg">ASK</div><div class="pi">${ic('spark')}<span class="t">Ask Hourglass: dyn</span><span class="h">Enter</span></div></div></div></div>`;
const newMenu = `<div class="menu desk-only" style="top:98px;left:12px;width:224px;position:absolute"><div class="mi hv">${ic('note')}Note</div><div class="mi">${ic('calendar-plus')}Event</div><div class="mi">${ic('folder')}Course</div><div class="mi">${ic('bell')}Alarm</div><div class="mi">${ic('reminder')}Reminder</div><div class="mi">${ic('timer')}Timer</div><div class="ms"></div><div class="mi">${ic('upload')}File</div></div>
  <div class="only-phone">${scrim()}<div class="layer sheetish"><div class="sheet"><i class="handle"></i><div class="sh"><h2>New</h2><span class="btn subtle sq x">${ic('close')}</span></div><div class="newsheet" style="grid-template-columns:repeat(3,1fr)">${[['note', 'Note'], ['calendar-plus', 'Event'], ['folder', 'Course'], ['bell', 'Alarm'], ['reminder', 'Reminder'], ['timer', 'Timer']].map(([i, l]) => `<span>${ic(i)}${l}</span>`).join('')}</div></div></div></div>`;
const newMenuRail = `<style>@media (max-width:979px) and (min-width:640px){.menu.desk-only{left:58px!important;top:66px!important;width:248px!important}}</style>`;
const toast = `<div class="toast">${ic('check', 'teal')}Alarm “Wind down” turned off ${btn('Undo')}</div>`;
const phoneMenu = `<div class="only-phone">${scrim()}<div class="layer sheetish"><div class="sheet"><i class="handle"></i><div class="sh"><div><h2>Eigenvalues</h2><p>Linear Algebra · Mon 5 Oct</p></div></div><div class="sb" style="gap:0;padding-top:12px">${[['pin', 'Pin to every session'], ['move', 'Move to course…'], ['share', 'Share'], ['history', 'Versions']].map(([i, l]) => `<div class="rrow" style="padding:0 4px;min-height:48px">${ic(i, 'muted')}<span class="lb"><b>${l}</b></span></div>`).join('')}<div class="rrow" style="padding:0 4px;min-height:48px;color:var(--ink)">${ic('trash')}<span class="lb"><b>Delete</b></span></div></div></div></div></div>`;

// ---------- the screens ----------
const S = [];
const add = (id, p, { overlay = false, phone = true } = {}) => S.push({ id, p, overlay, phone });
add('now', nowPage());
add('now-next', nowPage({ next: true }));
add('schedule-week', schedulePage());
add('schedule-day', scheduleDayPage());
add('schedule-month', scheduleMonthPage(), { phone: false });
add('attendance', attendancePage());
add('notes', notesPage());
add('note', notePage());
add('drive', drivePage());
add('alarms', alarmsPage());
add('reminders', remindersPage());
add('timers', timersPage());
add('world', worldPage());
add('assistant', assistantPage());
add('assistant-empty', assistantPage({ empty: true }));
add('settings', settingsPage());
add('signin', { raw: bare(signinBody()) });
add('starting', { raw: bare(`<div class="center starting">${logo(6)}<p>Starting Hourglass…</p><div class="indet"></div></div>`) });
add('new', { ...nowPage(), overlay: newMenu + newMenuRail }, { overlay: true });
add('palette', { ...nowPage(), overlay: paletteOverlay }, { overlay: true, phone: false });
add('session', { ...schedulePage(), overlay: sessionSheet }, { overlay: true });
add('event', { ...schedulePage(), overlay: eventSheet }, { overlay: true });
add('course', { ...notesPage(), overlay: courseSheet }, { overlay: true });
add('alarm-new', { ...alarmsPage(), overlay: alarmSheet }, { overlay: true });
add('versions', { ...notePage(), overlay: versionsSheet }, { overlay: true });
add('confirm', { ...notePage(), overlay: confirmSheet }, { overlay: true });
add('menu', { ...notesPage({ menu: true }), overlay: phoneMenu }, { overlay: true });
add('toast', { ...alarmsPage(), toast }, { overlay: true });
add('ring', { ...nowPage(), overlay: ringOverlay() }, { overlay: true });
add('ring-timer', { ...timersPage(), overlay: ringOverlay(true) }, { overlay: true, phone: true });
add('drive-drop', drivePage({ drop: true }), { overlay: true, phone: false });
add('drive-upload', drivePage({ uploads: true }), { overlay: true });

export const DESKTOP = [[390, 844], [768, 1024], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440], [3840, 2160]];
export const OVERLAY = [[768, 1024], [1440, 900], [3840, 2160]];
export const PHONE = [390, 844];

await rm(path.join(root, 'screens'), { recursive: true, force: true });
await rm(path.join(root, 'phone'), { recursive: true, force: true });
await mkdir(path.join(root, 'screens'), { recursive: true });
await mkdir(path.join(root, 'phone'), { recursive: true });
const manifest = [];
for (const s of S) {
  const body = s.p.raw ?? page(s.p);
  await writeFile(path.join(root, 'screens', `${s.id}.html`), doc(body));
  for (const [w, h] of s.overlay ? OVERLAY : DESKTOP) manifest.push({ file: `screens/${s.id}`, out: `png/${s.id}/${w}.png`, w, h });
  if (s.phone) {
    await writeFile(path.join(root, 'phone', `${s.id}.html`), doc(body, { device: true }));
    manifest.push({ file: `phone/${s.id}`, out: `png/${s.id}/phone.png`, w: PHONE[0], h: PHONE[1] });
  }
}
// Contact sheets: images only, no captions.
await rm(path.join(root, 'overview'), { recursive: true, force: true });
await mkdir(path.join(root, 'overview'), { recursive: true });
const sheetDoc = (imgs, cols, w) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#0b0b0b}body{display:grid;grid-template-columns:repeat(${cols},1fr);gap:40px;padding:56px;align-items:start}img{width:100%;display:block;outline:1px solid #262626}</style></head><body>${imgs.map((i) => `<img src="../${i}">`).join('')}</body></html>`;
const sheets = [
  ['phone', S.filter((s) => s.phone).map((s) => `png/${s.id}/phone.png`), 8, 3600],
  ...DESKTOP.map(([w]) => [`desktop-${w}`, S.filter((s) => !s.overlay).map((s) => `png/${s.id}/${w}.png`), w < 700 ? 9 : w < 1000 ? 6 : 4, 3600]),
  ['overlays', S.filter((s) => s.overlay).map((s) => `png/${s.id}/1440.png`), 4, 3600],
];
for (const [name, imgs, cols, w] of sheets) {
  await writeFile(path.join(root, 'overview', `${name}.html`), sheetDoc(imgs, cols, w));
  manifest.push({ file: `overview/${name}`, out: `overview/${name}.png`, w, h: 0, sheet: true });
}
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${S.length} screens, ${manifest.length} renders`);
