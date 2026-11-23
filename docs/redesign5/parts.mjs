// Shared parts for round 5: icons, logo, demo data, phone and PC shells. One set of components for both.

// Square-cap 24px line icons, drawn for Hourglass (1.75 stroke, miter joins: they sit with the square UI).
const P = {
  now: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  schedule: '<path d="M3.5 5.5h17v15h-17z M3.5 10h17 M8 3v4 M16 3v4"/><path class="f" d="M7 13h2.5v2.5H7z M11 13h2.5v2.5H11z M15 13h2.5v2.5H15z M7 16.5h2.5V19H7z"/>',
  notes: '<path d="M5 3.5h10l4 4v13H5z M15 3.5v4h4 M8.5 11.5h7 M8.5 15h7 M8.5 18h4"/>',
  drive: '<path d="M3.5 6h6l2 2.5h9v11h-17z M3.5 11h17"/>',
  time: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 1.5 M3.5 6l3.5-3 M20.5 6l-3.5-3 M7 19.5l-1.5 2 M17 19.5l1.5 2"/>',
  assistant: '<path d="M4 4.5h16v11H11l-4.5 4v-4H4z"/><path class="f" d="M12 6.8l.95 2.3 2.3.95-2.3.95L12 13.3l-.95-2.3-2.3-.95 2.3-.95z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8l1.7 2.4 2.9-.7.6 2.9 2.5 1.6-1.4 2.6 1.4 2.6-2.5 1.6-.6 2.9-2.9-.7L12 21.2l-1.7-2.4-2.9.7-.6-2.9-2.5-1.6L5.7 12 4.3 9.4l2.5-1.6.6-2.9 2.9.7z"/>',
  plus: '<path d="M12 5v14 M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  pin: '<path d="M9 3.5h6 M10 3.5v5.5l-3 4h10l-3-4V3.5 M12 13v7.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11 M17.5 6.5l-11 11"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>', right: '<path d="M9.5 6l6 6-6 6"/>', down: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
  back: '<path d="M19 12H5 M11 6l-6 6 6 6"/>',
  more: '<path class="f" d="M4.5 10.75h2.5v2.5H4.5z M10.75 10.75h2.5v2.5h-2.5z M17 10.75h2.5v2.5H17z"/>',
  place: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><path d="M10 8h4v4h-4z"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5"/>',
  usercheck: '<circle cx="9.5" cy="8" r="3.5"/><path d="M3 20c.8-3.8 3.5-5.5 6.5-5.5 1.2 0 2.3.2 3.3.7 M14.5 17.5l2.2 2.2 4.3-4.7"/>',
  timer: '<path d="M6.5 3.5h11 M6.5 20.5h11 M7.5 3.5c0 4 4.5 5.5 4.5 8.5s-4.5 4.5-4.5 8.5 M16.5 3.5c0 4-4.5 5.5-4.5 8.5s4.5 4.5 4.5 8.5"/><path class="f" d="M9.5 18.5h5l-2.5-3z"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z M10 21h4"/>',
  skip: '<path d="M5.5 6l8.5 6-8.5 6z M17.5 6v12"/>',
  undo: '<path d="M9 6.5L4.5 11 9 15.5 M5 11h9.5a5 5 0 0 1 0 10H11"/>',
  clip: '<path d="M16.5 7.5l-7 7a2 2 0 0 0 2.8 2.8l7.4-7.4a4 4 0 0 0-5.7-5.7L6.6 11.6a6 6 0 0 0 8.5 8.5l5.4-5.4"/>',
  up: '<path d="M12 19.5V5 M6 11l6-6 6 6"/>',
  stop: '<path class="f" d="M7 7h10v10H7z"/>',
  edit: '<path d="M4 20h4.5L19.5 9 15 4.5 4 15.5z M13 6.5l4.5 4.5"/>',
  bold: '<path d="M7 4.5h6a3.5 3.5 0 0 1 0 7H7z M7 11.5h7a3.75 3.75 0 0 1 0 7.5H7z"/>',
  italic: '<path d="M10 4.5h8 M6 19.5h8 M14.5 4.5l-5 15"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4 M5 20.5h14"/>',
  strike: '<path d="M4.5 12h15 M16.5 7.5c-.5-2-2.2-3-4.5-3-2.8 0-4.5 1.4-4.5 3.4 0 1.4.8 2.4 2.5 3 M7.5 16.3c.5 2 2.2 3.2 4.6 3.2 2.8 0 4.6-1.4 4.6-3.5 0-.9-.3-1.6-.9-2.1"/>',
  heading: '<path d="M6 4.5v15 M17 4.5v15 M6 12h11"/>',
  list: '<path d="M10 6.5h10 M10 12h10 M10 17.5h10"/><path class="f" d="M4 5.25h2.5v2.5H4z M4 10.75h2.5v2.5H4z M4 16.25h2.5v2.5H4z"/>',
  checklist: '<path d="M11 7h9 M11 17h9 M3.5 6.5l2 2 3.5-4"/><path d="M4 14.5h4.5V19H4z"/>',
  image: '<path d="M3.5 4.5h17v15h-17z M3.5 16l5-5 4 4 2.5-2.5 5.5 5.5"/><path d="M14.5 8h2.5v2.5h-2.5z"/>',
  sync: '<path d="M19.5 9A8 8 0 0 0 5 7.5 M4.5 3.5v4.5H9 M4.5 15A8 8 0 0 0 19 16.5 M19.5 20.5V16H15"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17 M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z"/>',
  trash: '<path d="M4.5 6.5h15 M9.5 6.5v-3h5v3 M6.5 6.5l1 14h9l1-14 M10.5 10.5v6 M13.5 10.5v6"/>',
  arrow: '<path d="M4.5 12h15 M13.5 6l6 6-6 6"/>',
  attend: '<path d="M3.5 5.5h17v15h-17z M3.5 10h17 M8 3v4 M16 3v4 M8.5 15l2.5 2.5 4.5-5"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3 M4.5 3.5v3.7h3.7 M12 8v4.5l3 1.5"/>',
  link: '<path d="M10 14l4-4 M8.5 11L6 13.5a3.2 3.2 0 0 0 4.5 4.5l2.5-2.5 M15.5 13l2.5-2.5A3.2 3.2 0 0 0 13.5 6L11 8.5"/>',
  mic: '<path d="M9 3.5h6v10H9z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5v3"/>',
  filter: '<path d="M4 5.5h16 M7 12h10 M10 18.5h4"/>',
  spark: '<path class="f" d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  flag: '<path d="M5.5 21V4 M5.5 4.5h12l-2.5 4 2.5 4h-12"/>',
  pause: '<path class="f" d="M7 5h3.5v14H7z M13.5 5H17v14h-3.5z"/>',
  warning: '<path d="M12 3.5l9 16H3z M12 10v4.5"/><path class="f" d="M11 16.5h2V18.5h-2z"/>',
  volume: '<path d="M4 9.5h4l5-4v13l-5-4H4z M16.5 9a4 4 0 0 1 0 6 M19 6.5a7.5 7.5 0 0 1 0 11"/>',
  minus: '<path d="M6 12h12"/>',
  coffee: '<path d="M4.5 9.5h12v6a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z M16.5 11h1.5a2.5 2.5 0 0 1 0 5h-1.5 M8 3.5v3 M12 3.5v3"/>',
};
export const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;

const ROWS = ['#########', '.#.....#.', '.#ooooo#.', '..#ooo#..', '...#o#...', '...#o#...', '..#.o.#..', '.#.ooo.#.', '.#ooooo#.', '#########'];
export const logo = (cell = 2.4) => `<svg width="${(9 * cell).toFixed(1)}" height="${(10 * cell).toFixed(1)}" viewBox="0 0 9 10" shape-rendering="crispEdges" style="flex:none">${ROWS.map((r, y) => [...r].map((c, x) => c === '.' ? '' : `<rect x="${x}" y="${y}" width="1" height="1" fill="${c === 'o' ? '#F0BE66' : '#B14242'}"/>`).join('')).join('')}</svg>`;

// ---------- demo data: Tuesday 6 October 2026, 09:37:12, Cairo ----------
export const C = {
  algo: { name: 'Algorithms', code: 'CS201', c: '#B14242', room: 'Room 4.12', who: 'Dr. Okafor' },
  lin: { name: 'Linear Algebra', code: 'MA210', c: '#4A8B8B', room: 'B204', who: 'Dr. Haddad' },
  print: { name: 'Printmaking', code: 'AR118', c: '#5B8C4A', room: 'NB631', who: 'Ms. Lindqvist' },
  phys: { name: 'Physics Lab', code: 'PH150', c: '#D66E36', room: 'Lab 3', who: 'Dr. Mensah' },
  hist: { name: 'Modern History', code: 'HI240', c: '#C2587E', room: 'Hall C', who: 'Dr. Farouk' },
  study: { name: 'Study group', c: '#F0BE66', room: 'Library' },
  gym: { name: 'Gym', c: '#8A8A8A', room: 'Sports hall' },
};
export const tint = (c, k = 45) => `color-mix(in srgb, ${c} ${k}%, #f5f5f5)`;
export const cc = (k) => `--cc:${C[k].c};--cct:${tint(C[k].c)}`;

// day (1 Mon .. 7 Sun), start, end, course, kind, title?
export const WEEK = [
  [1, 10, 11.5, 'lin', 'Lecture'], [1, 14, 15.5, 'hist', 'Lecture'],
  [2, 8, 10, 'algo', 'Lecture'], [2, 11, 12, 'lin', 'Tutorial'], [2, 13.5, 16, 'print', 'Studio'], [2, 16.25, 17.5, 'study', 'Event'],
  [3, 10, 11.5, 'lin', 'Lecture'], [3, 14, 15.5, 'hist', 'Lecture'],
  [4, 8, 10, 'algo', 'Lecture'], [4, 14, 17, 'phys', 'Lab'],
  [5, 9, 10, 'lin', 'Exam', 'Quiz 2'], [5, 12, 13, 'algo', 'Tutorial'],
  [6, 10, 11, 'gym', 'Event'],
];
export const DAYS = ['Mon 5 Oct', 'Tue 6 Oct', 'Wed 7 Oct', 'Thu 8 Oct', 'Fri 9 Oct', 'Sat 10 Oct', 'Sun 11 Oct'];
export const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const hm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
export const NOW = 9 + 37 / 60; // 09:37
export const LIVE_P = ((NOW - 8) / 2 * 100).toFixed(1); // 80.8% through 08:00-10:00

export const NOTES = {
  dp: { t: 'Dynamic programming', c: 'algo', when: 'Today', p: 'Memoisation vs tabulation. Knapsack table: rows are items, columns are capacity; fill bottom-up and read the answer from the last cell. Overlapping subproblems plus optimal substructure means DP.' },
  sheet: { t: 'Exam formula sheet', c: 'algo', when: 'Pinned', pin: true, p: 'Master theorem cases, amortised analysis, the three graph traversals and when each one wins. Bring a printed copy on the 22nd.' },
  ps3: { t: 'Problem set 3 plan', c: 'algo', when: 'Today', todo: [['Read chapter 15.3 on LCS', true], ['Draw the knapsack table for Q2', true], ['Write the recurrence for Q4', false], ['Ask Dr. Okafor about Q5', false]] },
  greedy: { t: 'Greedy vs DP', c: 'algo', when: 'Thu 1 Oct', p: 'Interval scheduling is greedy-safe; coin change with odd denominations is not. An exchange argument proves greedy correct.' },
  eig: { t: 'Eigenvalues and eigenvectors', c: 'lin', when: 'Mon 5 Oct', p: 'det(A − λI) = 0. The trace is the sum of the eigenvalues, the determinant their product. Symmetric matrices have real eigenvalues and orthogonal eigenvectors.' },
  lino: { t: 'Linocut process', c: 'print', when: 'Tue 29 Sep', p: 'Warm the block before cutting. V-gouge for lines, U-gouge to clear. Ink thin, roll in four directions, burnish from the centre out.' },
  lab: { t: 'Lab 2 report: pendulum', c: 'phys', when: 'Thu 1 Oct', p: 'Period against length. Plot T² against L; the slope gives 4π²/g. Our g came out at 9.74 ± 0.08 m/s².' },
  essay: { t: 'Essay outline: 1919', c: 'hist', when: 'Wed 30 Sep', p: 'Thesis: the 1919 revolution was national before it was social. Three parts: the delegation, the strikes, the settlement.' },
  read: { t: 'Reading list', c: 'hist', when: 'Pinned', pin: true, p: 'Fahmy, Ordinary Egyptians. Gershoni and Jankowski, Egypt, Islam and the Arabs. Chapters 2 and 5 first.' },
  matrix: { t: 'Row reduction', c: 'lin', when: 'Wed 30 Sep', p: 'Pivot, scale, eliminate below, then back-substitute. Rank is the number of pivots; free columns give the null space.' },
  week: { t: 'This week', c: null, when: 'Inbox', todo: [['Print the problem set', true], ['Buy lino ink, black', false], ['Book a library room for Tuesday', true], ['Email Dr. Mensah about lab 3', false]] },
};

export const noteRow = (k, { lines = 2, todoMax = 3 } = {}) => {
  const n = NOTES[k];
  const co = n.c ? C[n.c] : null;
  const body = n.todo
    ? `<ul class="todo sm" style="margin-top:8px">${n.todo.slice(0, todoMax).map(([t, d]) => `<li class="${d ? 'done' : ''}">${t}</li>`).join('')}</ul>`
    : `<div class="p ${lines === 4 ? 'l4' : lines === 6 ? 'l6' : ''}">${n.p}</div>`;
  const more = n.todo && n.todo.length > todoMax ? `<span class="faint">· ${n.todo.length - todoMax} more</span>` : '';
  const done = n.todo ? `<span>${n.todo.filter((x) => x[1]).length}/${n.todo.length} done</span>` : '';
  return `<div class="card nrow" style="${co ? `--cc:${co.c};--cct:${tint(co.c)}` : '--cc:#3a3a3a'}"><span class="cc-edge"></span><div class="h"><span class="grow">${n.t}</span>${n.pin ? `<span class="gold">${ic('pin', 's18')}</span>` : ''}</div>${body}<div class="m">${co ? `<span class="dot"></span><span class="cn">${co.name}</span><span class="faint">·</span>` : `<span class="dot" style="--cc:#555"></span><span>Inbox</span><span class="faint">·</span>`}<span>${n.when}</span>${done ? `<span class="faint">·</span>${done}` : ''}${more}</div></div>`;
};

// ---------- phone shell ----------
const sig = `<span class="sig"><svg width="18" height="12" viewBox="0 0 18 12"><path fill="#f5f5f5" d="M0 9h3v3H0zM5 6h3v6H5zM10 3h3v9h-3zM15 0h3v12h-3z"/></svg><svg width="16" height="12" viewBox="0 0 16 12"><path fill="none" stroke="#f5f5f5" stroke-width="1.8" d="M1 4.5a10 10 0 0 1 14 0M3.6 7.2a6.2 6.2 0 0 1 8.8 0"/><path fill="#f5f5f5" d="M6.4 9.4h3.2V12H6.4z"/></svg><svg width="26" height="12" viewBox="0 0 26 12"><path fill="none" stroke="#9a9a9a" stroke-width="1" d="M.5.5h22v11H.5z"/><path fill="#f5f5f5" d="M2 2h16v8H2zM23.5 4h2v4h-2z"/></svg></span>`;
const TABS = [['now', 'Now'], ['schedule', 'Schedule'], ['notes', 'Notes'], ['drive', 'Drive'], ['time', 'Time']];
export const phone = ({ tab, head, body, after = '', fade = true, bodyStyle = '', foot = '', fab = '' }) => `<div class="phone"><div class="status"><span class="num">9:37</span>${sig}</div>${head}${after}<div class="ph-body ${fade ? 'fade' : ''}" style="${bodyStyle}">${body}</div>${foot}${fab}${tab === null ? '' : `<nav class="tabbar">${TABS.map(([k, l]) => `<span class="tb ${k === tab ? 'on' : ''}">${ic(k, 's24')}<span>${l}</span></span>`).join('')}</nav>`}</div>`;
export const appHead = (busy = false) => `<header class="ph-head">${logo(2.6)}<span class="name">Hourglass</span><span class="acts"><span class="hbtn">${ic('assistant', 's24')}${busy ? '<span class="badge"></span>' : ''}</span><span class="hbtn">${ic('gear', 's24')}</span></span></header>`;

// ---------- PC shell: the phone's tabs become the sidebar ----------
const NAV = [
  ['now', 'Now', 'now'], ['schedule', 'Schedule', 'schedule', [['schedule', 'Week'], ['attendance', 'Attendance']]],
  ['notes', 'Notes', 'notes', null, '42'], ['drive', 'Drive', 'drive'],
  ['time', 'Time', 'time', [['alarms', 'Alarms'], ['timers', 'Timers'], ['clock', 'World clock']]],
];
export const pc = ({ on, sub, title, crumb = '', tools = '', content, cols = '1fr', live = true, busy = false }) => {
  const nav = NAV.map(([k, l, icon, subs, cnt]) => {
    const active = k === on;
    const s = subs && active ? subs.map(([sk, sl]) => `<span class="nav sub ${sk === sub ? 'on' : ''}">${sl}</span>`).join('') : '';
    return `<span class="nav ${active && !subs ? 'on' : active ? 'on' : ''}">${ic(icon)}<span>${l}</span>${cnt ? `<span class="cnt">${cnt}</span>` : ''}</span>${s}`;
  }).join('');
  const mini = live ? `<div class="card mini" style="--cc:#B14242"><div class="row"><span class="tag onair"><i class="pulse"></i>Live</span><span class="faint" style="margin-left:auto;font:500 11px var(--mono)">until 10:00</span></div><div class="h">Algorithms</div><div class="s">23 min left</div><div class="prog" style="margin-top:12px"><div class="bar" style="--p:${LIVE_P}%;height:4px"><i></i></div></div></div>` : '';
  return `<div class="pc"><aside class="side"><div class="brand">${logo(2.6)}<b>Hourglass</b><small>0.4.0</small></div><span class="btn primary new">${ic('plus', 's18')}<span>New</span><kbd>Ctrl N</kbd></span>${nav}<span class="nav ${on === 'assistant' ? 'on' : ''}" style="margin-top:12px">${ic('assistant')}<span>Assistant</span>${busy ? '<span class="cnt" style="color:var(--ink)">working</span>' : ''}</span>${mini}<span class="nav" style="margin-top:${live ? 12 : 0}px">${ic('gear')}<span>Settings</span></span><div class="foot"><span class="ok"></span>Synced<span class="faint">· 4 devices</span></div></aside><main class="main"><header class="topbar"><h1>${title}</h1><span class="crumb">${crumb}</span>${tools}<span class="field search">${ic('search', 's18')}<span class="grow">Search or ask Hourglass</span><kbd>Ctrl K</kbd></span></header><div class="content" style="grid-template-columns:${cols}">${content}</div></main></div>`;
};
