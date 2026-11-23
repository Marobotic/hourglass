// Hourglass's window: boot, the shared state, the sidebar, the page router, keys, the command palette and the
// whole-window states (starting, signed out, ringing, reminders, drop to upload). REDESIGN.md §3 and §7.
import { h, icon, logo, $, burstAt } from './dom.js';
import { api } from './api.js';
import * as U from './util.js';
import * as kit from './kit.js';
import { PAGES, NAV } from './pages/index.js';
import * as dialogs from './pages/dialogs.js';
import { startUploadPanel } from './uploads.js';
import './native.js';

const TAURI = globalThis.__TAURI__;
const invoke = (cmd, args) => TAURI?.core?.invoke(cmd, args);
// The window's own version (package.json, set by build.mjs); the service may be older or newer.
const VERSION = globalThis.HOURGLASS_VERSION || '0.4.0';

// ---- shared state -------------------------------------------------------------------------------------
const listeners = new Map(); // event -> Set(fn); events: tick, state, data, page
const on = (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev)?.delete(fn); };
const emit = (ev, ...a) => { for (const fn of [...(listeners.get(ev) || [])]) { try { fn(...a); } catch (e) { console.error(e); } } };

const state = {
  app: { ringing: [], reminders: [], sync: { state: 'local' } }, // GET /api/app
  now: null,        // GET /api/now
  courses: [],      // GET /api/courses/summary
  settings: {},
  clock: Date.now(),
  skew: 0,
  loaded: false,
  dataRev: -1,
  page: 'now',
  arg: null,
  dev: new URLSearchParams(location.search),
};

const ctx = {
  api, state, on, emit, U, kit,
  go, toast: kit.toast,
  // The page header every page draws (REDESIGN §3): title, a muted context line or controls, actions.
  // Every header ends with Search or ask (the command palette, Ctrl K).
  head({ title, ctx: line, mid, acts = [], back, ask = true } = {}) {
    return h('div', { class: 'head' },
      back ? kit.btn('Back', back, { kind: 'subtle', icon: 'back', title: 'Back (Esc)', cls: 'back' }) : null,
      h('h1', { text: title }),
      line != null ? h('span', { class: 'ctx', text: line }) : null,
      mid ? h('div', { class: 'mid' }, mid) : null,
      h('div', { class: 'acts' }, acts),
      ask ? h('button', { class: 'ask', type: 'button', title: 'Search or ask Hourglass (Ctrl K)', onclick: () => openPalette() }, icon('search'), h('span', { class: 'lbl', text: 'Search or ask Hourglass' }), h('kbd', { text: 'Ctrl K' })) : null);
  },
  courseById: (id) => state.courses.find((c) => c.id === id) || null,
  courseColor: (id) => ctx.courseById(id)?.color || 'var(--teal)',
  courseOptions: (withNone) => {
    const o = state.courses.map((c) => ({ label: c.name, value: c.id, color: c.color }));
    return withNone ? [{ label: 'No course', value: null }, ...o] : o;
  },
  // --- actions shared by pages (Main.qml) ---
  openNote(note) { go('note', note); },
  async newNote(fields = {}) {
    const n = await api.action('add_note', fields).catch(() => null);
    if (n) go('note', n);
  },
  // Opens today's note for a session, creating it on first use.
  sessionNote(occ, existing) {
    if (existing && existing.length) return ctx.openNote(existing[0]);
    const day = occ.session_date || occ.date;
    return ctx.newNote({ course: occ.course_id, date: day, title: U.shortDate(day) });
  },
  startTimer(minutes, label) { return api.action('start_timer', { minutes, label }); },
  openSession: (occ) => dialogs.session(ctx, occ),
  editEvent: (ev, defaults) => dialogs.event(ctx, ev, defaults),
  editCourse: (c) => dialogs.course(ctx, c),
  confirm: kit.confirm,
  refresh,
  pollState,
  burstAt,
  // The current page's drop handler (paths from Explorer); Drive's uploads by default.
  dropHandler: null,
};

// ---- boot -------------------------------------------------------------------------------------------
async function boot() {
  let hidden = false;
  if (TAURI) {
    try {
      // The window hands this over before the page runs (__HG_BOOT); asking is the fallback.
      const b = globalThis.__HG_BOOT || await invoke('boot');
      hidden = !!b.hidden;
      api.base = `http://127.0.0.1:${b.port}`;
      api.token = b.token;
    } catch (e) { console.error(e); }
  } else {
    // A plain browser (dev): ?port=8941&token=... against a running service.
    api.base = `http://127.0.0.1:${state.dev.get('port') || 8931}`;
    api.token = state.dev.get('token') || '';
  }
  if (state.dev.get('page')) { state.page = state.dev.get('page'); }
  buildShell();
  startUploadPanel();
  api.on('changed', () => refresh());
  api.on('error', (msg) => { if (state.app.account?.signed_in !== false || state.dev.has('nologin')) kit.toast(msg); });
  pollState();
  refresh();
  setInterval(() => pollState(), 2000);
  setInterval(() => { if (onScreen()) refresh(); }, 15000);
  scheduleTick();
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('motion-paused', !onScreen());
    if (onScreen() && state.loaded) wake();
  });
  if (TAURI) {
    askWindow();
    listenDrops();
    // The window starts hidden so it never flashes white; show it once the shell is drawn. Warmed up
    // at sign-in (--hidden), it stays in the tray until Hourglass is opened.
    if (!hidden) requestAnimationFrame(() => invoke('show_window'));
  }
  document.addEventListener('keydown', onKey);
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea, [contenteditable], .selectable')) e.preventDefault(); });
}

const onScreen = () => document.visibilityState === 'visible';

// Back after time in the tray or minimised: the clock jumps to now and everything reloads.
function wake() {
  state.clock = Date.now() + state.skew;
  pollState();
  refresh();
  emit('tick');
}

async function refresh() {
  const [now, courses, notes] = await Promise.all([
    api.get('/api/now', { quiet: true }).catch(() => null),
    api.get('/api/courses/summary', { quiet: true }).catch(() => null),
    api.get('/api/notes', { quiet: true }).catch(() => null),
  ]);
  if (courses) state.courses = courses;
  if (notes) { state.notes = notes; state.noteCount = notes.length; }
  if (now) {
    state.now = now;
    if (!state.loaded) { state.loaded = true; hideStarting(); }
  } else if (!state.loaded) {
    // The service is still starting: ask again soon, not at the next 15 s refresh.
    setTimeout(refresh, 250);
  }
  emit('data');
  renderSide();
}

let polling = false;
async function pollState() {
  if (polling) return;
  polling = true;
  try {
    const d = await api.get('/api/app', { quiet: true }).catch(() => null);
    if (!d) return;
    applyTheme(d.theme);
    if (d.settings) {
      U.prefs.h24 = d.settings.time_format === '24h';
      U.prefs.weekStartDay = d.settings.week_start || 6;
      state.settings = d.settings;
    }
    if (d.tz_offset_min !== undefined) U.prefs.offsetMin = d.tz_offset_min;
    if (d.data_rev !== undefined) {
      if (state.dataRev >= 0 && d.data_rev !== state.dataRev) refresh();
      state.dataRev = d.data_rev;
    }
    if (d.clock_skew_ms !== undefined && d.clock_skew_ms !== state.skew) { state.skew = d.clock_skew_ms; state.clock = Date.now() + state.skew; }
    const changed = JSON.stringify(d) !== JSON.stringify(state.app);
    const wasRinging = (state.app.ringing || []).length;
    state.app = d;
    if (changed) {
      renderSide();
      renderRing();
      renderReminders();
      renderLogin();
      emit('state');
    }
    // An alarm started ringing while the window sat in the tray: bring it back.
    if ((d.ringing || []).length && !wasRinging && TAURI) invoke('show_window');
  } finally { polling = false; }
}

// Colours follow the service's theme (Omarchy on Linux); the derived surfaces are CSS mixes.
let themeKey = '';
function applyTheme(t) {
  if (!t) return;
  const key = JSON.stringify(t);
  if (key === themeKey) return;
  themeKey = key;
  const r = document.documentElement.style;
  const set = (v, c) => { if (c) r.setProperty(v, c); };
  set('--bg', t.background); set('--fg', t.foreground); set('--accent', t.accent);
  set('--orange', t.color1); set('--gold', t.color3); set('--teal', t.color4); set('--grey', t.color8);
  const bg = t.background || '#121212';
  const n = parseInt(bg.slice(1), 16), lum = ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
  document.documentElement.classList.toggle('light', lum >= 0.5);
}

// The clock moves only as often as something shows it: every second while seconds are on screen, otherwise on
// the minute. Paused while the window is away.
let tickTimer = 0;
const showsSeconds = () => onScreen() && ((state.app.ringing || []).length > 0
  || (state.now?.timers || []).some((t) => t.state === 'running')
  || (state.page === 'now' && !!state.now?.active)
  || state.page === 'timers');
function scheduleTick() {
  clearTimeout(tickTimer);
  const wait = showsSeconds() ? 1000 - (Date.now() % 1000) : Math.max(1000, 60000 - ((Date.now() + state.skew) % 60000));
  tickTimer = setTimeout(() => {
    if (onScreen()) { state.clock = Date.now() + state.skew; emit('tick'); renderSideTick(); }
    scheduleTick();
  }, wait);
}

// Opening Hourglass from the Start menu while the window sits in the tray: the launcher asks the service, which
// bumps show_seq, and the window comes back. The service holds the question open until that number moves.
let showSeq = -1;
async function askWindow() {
  const asked = Date.now();
  try {
    const d = await api.get(`/api/window?since=${showSeq}`, { quiet: true });
    if (showSeq >= 0 && d.show_seq !== showSeq) invoke('show_window');
    showSeq = d.show_seq;
    setTimeout(askWindow, Date.now() - asked > 1000 ? 1 : 3000);
  } catch (e) {
    if (e.status === 404) return; // an older or non-Windows service: no window routes
    setTimeout(askWindow, 3000);
  }
}

// Files dragged in from Explorer: the page under them takes them (notes, the assistant), else they go to Drive.
async function listenDrops() {
  const ev = TAURI.event;
  let tint = null;
  const clear = () => { tint?.remove(); tint = null; };
  await ev.listen('tauri://drag-enter', () => {
    if (tint || state.app.account?.signed_in === false) return;
    tint = h('div', { class: 'droptint', text: ctx.dropHandler?.label || 'Drop to upload to your Drive' });
    $('.main').append(tint);
  });
  await ev.listen('tauri://drag-leave', clear);
  await ev.listen('tauri://drag-drop', (e) => {
    clear();
    const paths = e.payload?.paths || [];
    if (!paths.length) return;
    if (ctx.dropHandler?.fn) ctx.dropHandler.fn(paths);
    else go('drive', { upload: paths });
  });
}

// ---- shell --------------------------------------------------------------------------------------------
let side, navBar, pageEl, current = null;

function buildShell() {
  side = h('aside', { class: 'side' });
  pageEl = h('div', { id: 'page' });
  const main = h('main', { class: 'main' }, pageEl);
  $('#app').replaceChildren(side, main);
  showStarting();
  renderSide();
  mount(state.page, state.arg);
  devOpen();
}

// Dev screenshots: ?open=note | event | course | session | palette | new opens that over the page.
async function devOpen() {
  const what = state.dev.get('open');
  if (!what) return;
  await new Promise((r) => setTimeout(r, 900));
  if (what === 'note') { const ns = await api.get('/api/notes').catch(() => []); const n = ns.find((x) => x.body && x.body.includes(String.fromCharCode(10))) || ns[0]; if (n) ctx.openNote(n); }
  else if (what === 'event') ctx.editEvent(null);
  else if (what === 'course') ctx.editCourse(null);
  else if (what === 'session') { const f = state.now?.active || state.now?.next || state.now?.today?.[0]; if (f) ctx.openSession(f); }
  else if (what === 'palette') openPalette();
  else if (what === 'new') newMenu(side.querySelector('.new'));
}

// A sidebar row. Sub rows (a group's pages) carry their icon too: the narrow sidebar shows only icons.
function navRow(id, { sub = false, label, iconName, onclick } = {}) {
  const def = PAGES[id] || {};
  const name = label || def.title;
  return h('button', { class: `nav ${sub ? 'sub' : ''}`, 'data-page': id, 'data-tip': innerWidth < 980 ? name : null, onclick: onclick || (() => go(id)) },
    icon(iconName || def.icon), h('span', { class: 'lbl', text: name }), def.key ? h('span', { class: 'kbd', text: def.key }) : null);
}
// Which top row a page sits under.
const groupOf = (page) => {
  const key = page === 'note' ? 'notes' : page;
  return NAV.find((g) => g.id === key || g.subs?.includes(key))?.id || key;
};
const scheduleLabel = () => ({ day: 'Day', week: 'Week', month: 'Month' })[localStorage.getItem('hg.scheduleMode') || 'week'] || 'Week';

function renderSide(animate = false) {
  if (!side) return;
  const a = state.app, n = state.now;
  const navs = h('div', { class: 'navs' });
  navBar = h('i', { class: 'nav-bar' });
  navs.append(navBar);
  const open = groupOf(state.page);
  // Counts: something ringing (Alarms, Timers), reminders waiting, the assistant working.
  const counts = { alarms: (a.ringing || []).filter((r) => r.kind !== 'timer').length, timers: (a.ringing || []).filter((r) => r.kind === 'timer').length, reminders: (a.reminders || []).length };
  const countChip = (c) => (c ? h('span', { class: 'count', text: String(c) }) : null);
  for (const g of NAV) {
    if (g.gap) { navs.append(h('i', { class: 'nav-gap' })); continue; }
    const row = g.page === false
      ? navRow(g.id, { label: g.title, iconName: g.icon, onclick: () => go(lastIn(g)) })
      : navRow(g.id);
    const expanded = open === g.id && g.subs;
    const groupCount = g.subs ? g.subs.reduce((t, s) => t + (counts[s] || 0), 0) : counts[g.id] || 0;
    if (!expanded && groupCount) row.insertBefore(countChip(groupCount), row.querySelector('.kbd'));
    if (g.id === 'notes' && state.noteCount) row.insertBefore(h('span', { class: 'cnt tnum', text: String(state.noteCount) }), row.querySelector('.kbd'));
    if (g.id === 'assistant' && state.assistantBusy) row.insertBefore(h('span', { class: 'cnt ink', text: 'working' }), row.querySelector('.kbd'));
    navs.append(row);
    if (expanded) for (const s of g.subs) {
      const r = navRow(s, { sub: true, label: s === 'schedule' ? scheduleLabel() : null, iconName: s === 'schedule' ? 'calendar' : null });
      if (counts[s]) r.insertBefore(countChip(counts[s]), r.querySelector('.kbd'));
      navs.append(r);
    }
  }

  const live = n?.active && n.active.state === 'live' ? n.active : null;
  const foot = h('div', { class: 'side-foot' },
    live ? miniCard(live) : null,
    a.update ? updateCard(a.update) : null,
    navRow('settings'),
    syncLine());

  side.replaceChildren(
    h('div', { class: 'brand' }, logo(2.6, { alive: true }), h('b', { text: 'Hourglass' }), h('span', { class: 'ver', text: VERSION })),
    kit.btn('New', (e) => newMenu(e.currentTarget), { kind: 'primary', icon: 'plus', kbd: 'Ctrl N', cls: 'new', title: 'New' }),
    navs, h('span', { class: 'grow' }), foot);
  placeNavBar(animate);
  renderSideTick();
}
// The Time row opens the time page you were last on.
const lastIn = (g) => { const p = localStorage.getItem('hg.last.' + g.id); return g.subs.includes(p) ? p : g.subs[0]; };

function miniCard(live) {
  return h('div', { class: 'card mini', onclick: () => go('now') },
    h('div', { class: 'top' }, kit.chip('Live', { cls: 'live' }), h('span', { class: 'until', text: 'until ' + U.t(live.end_time) })),
    h('div', { class: 't', text: live.title }), h('div', { class: 's mini-left' }), kit.progress({ thin: true }));
}
function renderSideTick() {
  const live = state.now?.active;
  const left = side?.querySelector('.mini-left');
  if (!live || !left) return;
  const start = live.start_ms ?? live.starts_at, end = live.end_ms ?? live.ends_at;
  if (end) left.textContent = U.left(Math.max(0, Math.ceil((end - state.clock) / 60000)));
  if (start && end) side.querySelector('.mini .prog')?.set((state.clock - start) / Math.max(1, end - start));
}

function updateCard(u) {
  let asked = false;
  const b = kit.btn(u.installing ? 'Installing…' : 'Install and restart', async () => {
    if (asked) return;
    asked = true;
    b.disabled = true;
    b.querySelector('.lbl').textContent = 'Installing…';
    try { await api.post('/api/update/install', {}, { readOnly: true }); } catch { asked = false; b.disabled = false; b.querySelector('.lbl').textContent = 'Install and restart'; }
  }, { kind: 'primary', compact: true, disabled: u.installing });
  return h('div', { class: 'update' }, kit.chip('Update ready', { cls: 'ok' }), h('b', { text: `Hourglass ${u.version}` }), u.notes ? h('p', { text: u.notes }) : null, b);
}

function syncLine() {
  const st = state.app.sync?.state || 'local';
  const email = state.app.account?.email;
  return h('div', { class: 'sync', 'data-tip': innerWidth < 980 ? syncWord(st) : null },
    h('i', { class: st }), h('b', { text: syncWord(st), style: { fontWeight: 500 } }), email ? h('span', { text: '· ' + email }) : null);
}
const syncWord = (st) => (st === 'synced' ? 'Synced' : st === 'offline' ? 'Offline, saved here' : st === 'syncing' ? 'Syncing…' : 'On this computer');

// The accent bar travels to the current top row (260 ms): it stretches toward the new row first, then its tail
// catches up. A freshly drawn sidebar places it without moving.
let barAt = null;
function placeNavBar(animate = true) {
  if (!navBar) return;
  const key = groupOf(state.page);
  const row = side.querySelector(`.nav:not(.sub)[data-page="${key}"]`);
  const subKey = state.page === 'note' ? 'notes' : state.page;
  side.querySelectorAll('.nav').forEach((n) => n.classList.toggle('on', n === row || (n.classList.contains('sub') && n.dataset.page === subKey)));
  if (!row || !navBar.parentElement.contains(row)) { navBar.style.opacity = '0'; barAt = null; return; }
  navBar.style.opacity = '1';
  const to = row.offsetTop + 8;
  navBar.style.transform = `translateY(${to}px)`;
  const from = barAt;
  barAt = to;
  if (!animate || from == null || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const top = Math.min(from, to), span = Math.abs(to - from) + 24;
  navBar.animate([
    { transform: `translateY(${from}px)`, height: '24px' },
    { transform: `translateY(${top}px)`, height: `${span}px`, offset: 0.45, easing: 'cubic-bezier(.2,.8,.2,1)' },
    { transform: `translateY(${to}px)`, height: '24px' },
  ], { duration: 260, easing: 'cubic-bezier(.4,0,.2,1)' });
}

// ---- router -------------------------------------------------------------------------------------------
export function go(page, arg = null) {
  if (!PAGES[page]) return;
  if (page === state.page && arg == null && page !== 'note') { current?.update?.('go'); return; }
  mount(page, arg);
}

function mount(page, arg) {
  const prev = current;
  current = null;
  ctx.dropHandler = null;
  try { prev?.unmount?.(); } catch (e) { console.error(e); }
  if (page === 'note' && state.page !== 'note') sessionStorage.setItem('hg.prevPage', state.page);
  // Where Back (and Esc) on a secondary page like Settings returns to.
  if (page !== state.page) state.prevPage = state.page;
  const group = NAV.find((g) => g.subs?.includes(page));
  if (group) localStorage.setItem('hg.last.' + group.id, page);
  state.page = page;
  state.arg = arg;
  const root = h('div', { class: 'view view-enter', 'data-page': page, style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } });
  pageEl.replaceChildren(root);
  try {
    current = PAGES[page].mount(root, ctx, arg) || {};
  } catch (e) {
    console.error(e);
    root.append(h('div', { class: 'empty' }, h('h2', { text: 'This page hit a problem' }), h('p', { class: 'selectable', text: String(e?.message || e) })));
  }
  renderSide(true);
  scheduleTick();
  emit('page', page);
}
// Pages update on these.
on('tick', () => current?.update?.('tick'));
on('data', () => current?.update?.('data'));
on('state', () => current?.update?.('state'));

// ---- New menu, keys, palette ------------------------------------------------------------------------------
async function newMenu(anchor) {
  const k = anchor
    ? await kit.menuAt(anchor, '', newItems(), { width: anchor.offsetWidth > 100 ? anchor.offsetWidth : 220 })
    : await kit.menu(innerWidth / 2 - 110, 120, 'New', newItems(), { width: 220 });
  runNew(k);
}
const newItems = () => [
  { key: 'note', label: 'Note', icon: 'note', hint: 'N' },
  { key: 'event', label: 'Event', icon: 'calendar-plus' },
  { key: 'course', label: 'Course', icon: 'courses' },
  { separator: true },
  { key: 'alarm', label: 'Alarm', icon: 'bell' },
  { key: 'reminder', label: 'Reminder', icon: 'reminder' },
  { key: 'timer', label: 'Timer', icon: 'timer' },
];
function runNew(k) {
  if (k === 'note') noteForNow();
  else if (k === 'event') ctx.editEvent(null);
  else if (k === 'course') ctx.editCourse(null);
  else if (k === 'alarm') go('alarms', { add: true });
  else if (k === 'reminder') go('reminders', { add: true });
  else if (k === 'timer') go('timers', { add: true });
}
// "n": a note for the current session, else a blank one.
function noteForNow() {
  const f = state.now?.focus;
  if (f && f.course_id) ctx.sessionNote(f, state.now.notes?.session);
  else ctx.newNote({});
}

function typing(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function onKey(e) {
  if (e.key === 'Escape') {
    if (kit.closeTop()) { e.preventDefault(); return; }
    if ($('.palette')) { closePalette(); return; }
    if (current?.escape?.()) { e.preventDefault(); return; }
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (mod && e.key.toLowerCase() === 'n' && state.page !== 'assistant') { e.preventDefault(); newMenu(side.querySelector('.new')); return; }
  if (mod || e.altKey || typing(e) || kit.overlayOpen() || $('.palette') || state.app.account?.signed_in === false) return;
  const byKey = Object.entries(PAGES).find(([, p]) => p.key && p.key.toLowerCase() === e.key.toLowerCase());
  if (byKey) { e.preventDefault(); go(byKey[0]); return; }
  if (e.key === 'n') { e.preventDefault(); noteForNow(); return; }
  const letters = { a: 'alarms', r: 'reminders', t: 'timers', w: 'world' };
  if (letters[e.key]) { e.preventDefault(); go(letters[e.key]); }
}

let paletteNotes = null;
function closePalette() { $('.palette')?.remove(); }
async function openPalette() {
  if ($('.palette')) return;
  const input = h('input', { placeholder: 'Search or ask Hourglass…', spellcheck: 'false' });
  const list = h('div', { class: 'palette-list' });
  const box = h('div', { class: 'palette', onmousedown: (e) => { if (e.target === box) closePalette(); } }, h('div', { class: 'palette-box' }, h('div', { class: 'palette-top' }, icon('search'), input, h('kbd', { text: 'Esc' })), list));
  document.body.append(box);
  input.focus();
  let kb = 0, items = [];
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    items = [];
    const pages = Object.entries(PAGES).filter(([id, p]) => !p.hidden && (!q || p.title.toLowerCase().includes(q)));
    if (pages.length) items.push({ grp: 'Pages' }, ...pages.map(([id, p]) => ({ icon: p.icon, label: p.title, hint: p.key || '', run: () => go(id) })));
    const cs = state.courses.filter((c) => q && c.name.toLowerCase().includes(q)).slice(0, 5);
    if (cs.length) items.push({ grp: 'Courses' }, ...cs.map((c) => ({ icon: 'courses', label: c.name, hint: c.code || '', run: () => go('notes', { course: c.id }) })));
    const ns = (paletteNotes || []).filter((n) => q && ((n.title || '').toLowerCase().includes(q) || (n.body || '').toLowerCase().includes(q))).slice(0, 6);
    if (ns.length) items.push({ grp: 'Notes' }, ...ns.map((n) => ({ icon: 'note', label: n.title || 'Untitled', hint: n.session_date ? U.shortDate(n.session_date) : '', run: () => ctx.openNote(n) })));
    items.push({ grp: 'Do' }, ...newItems().filter((i) => !i.separator && (!q || ('new ' + i.label).toLowerCase().includes(q))).map((i) => ({ icon: i.icon, label: 'New ' + i.label.toLowerCase(), run: () => runNew(i.key) })));
    if (q) items.push({ icon: 'spark', label: `Ask Hourglass: ${input.value.trim()}`, hint: 'Enter', run: () => go('assistant', { send: input.value.trim() }), ask: true });
    const runnable = items.filter((i) => !i.grp);
    kb = Math.min(kb, runnable.length - 1);
    if (q && !pages.length && !cs.length && !ns.length) kb = runnable.findIndex((i) => i.ask);
    list.replaceChildren(...items.map((i) => i.grp ? h('div', { class: 'grp', text: i.grp.toUpperCase() })
      : h('button', { class: runnable.indexOf(i) === kb ? 'kb' : '', onclick: () => { closePalette(); i.run(); } }, icon(i.icon), h('span', { class: 'ellipsis', text: i.label }), i.hint ? h('span', { class: 'hint', text: i.hint }) : null)));
    list.querySelector('.kb')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => { kb = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    const runnable = items.filter((i) => !i.grp);
    if (e.key === 'ArrowDown') { e.preventDefault(); kb = (kb + 1) % runnable.length; draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); kb = (kb + runnable.length - 1) % runnable.length; draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = runnable[kb]; closePalette(); it?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  draw();
  paletteNotes = state.notes || await api.get('/api/notes', { quiet: true }).catch(() => []);
  if ($('.palette')) draw();
}

// ---- whole-window states ------------------------------------------------------------------------------------
let startingEl = null;
function showStarting() {
  startingEl = h('div', { class: 'starting' }, logo(6, { alive: true }), h('p', { text: 'Starting Hourglass…' }), h('div', { class: 'line' }, h('i')));
  document.body.append(startingEl);
}
function hideStarting() {
  if (!startingEl) return;
  const el = startingEl;
  startingEl = null;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 200);
}

let loginEl = null;
function renderLogin() {
  const out = state.dev.has('login') || (state.loaded && state.app.account && !state.app.account.signed_in && !state.dev.has('nologin'));
  if (out && !loginEl) {
    loginEl = h('div', { class: 'login-wrap' });
    document.body.append(loginEl);
    PAGES.login.mount(loginEl, ctx);
  } else if (!out && loginEl) {
    loginEl.remove();
    loginEl = null;
    refresh();
  }
}
on('data', renderLogin);

let ringEl = null, ringId = null;
function renderRing() {
  const item = (state.app.ringing || [])[0] || null;
  if (!item) { ringEl?.remove(); ringEl = null; ringId = null; return; }
  if (ringEl && ringId === item.id) { ringEl.querySelector('.clock').textContent = U.clock(state.clock); return; }
  ringEl?.remove();
  ringId = item.id;
  const hold = h('button', { class: 'btn hold big', type: 'button' }, h('i'), h('span', { text: 'Hold to dismiss' }));
  let timer = 0;
  const start = () => {
    hold.classList.add('holding');
    hold.querySelector('span').textContent = 'Hold to dismiss';
    timer = setTimeout(() => api.post(`/api/ring/stop?id=${encodeURIComponent(item.id)}&via=${encodeURIComponent('held Dismiss in the window')}`, {}).then(pollState), 2000);
  };
  const cancel = () => {
    if (!hold.classList.contains('holding')) return;
    clearTimeout(timer);
    hold.classList.remove('holding');
    hold.querySelector('span').textContent = 'Keep holding to dismiss';
  };
  hold.addEventListener('pointerdown', start);
  hold.addEventListener('pointerup', cancel);
  hold.addEventListener('pointerleave', cancel);
  // Square ripples round a rocking bell, the time breathing red; Hold to dismiss (2 s) and Snooze 5 min.
  ringEl = h('div', { class: 'ring' }, h('div', { class: 'ring-card', role: 'alertdialog', 'aria-label': item.label || 'Alarm' },
    h('div', { class: 'bellw' }, h('i', { class: 'rp' }), h('i', { class: 'rp' }), h('i', { class: 'rp' }), icon(item.kind === 'timer' ? 'timer' : 'bell')),
    h('div', { class: 'kind', text: item.kind === 'timer' ? "TIME'S UP" : 'ALARM' }),
    h('div', { class: 'clock', text: U.clock(state.clock) }),
    h('div', { class: 'label', text: item.label || '' }),
    h('div', { class: 'acts' }, hold,
      kit.btn('Snooze 5 min', () => api.post(`/api/ring/snooze?id=${encodeURIComponent(item.id)}&minutes=5&via=${encodeURIComponent('clicked Snooze in the window')}`, {}).then(pollState), { cls: 'snooze big' }))));
  document.body.append(ringEl);
}
on('tick', () => { if (ringEl) ringEl.querySelector('.clock').textContent = U.clock(state.clock); });

let remindersEl = null;
function renderReminders() {
  const list = (state.app.ringing || []).length ? [] : (state.app.reminders || []);
  if (!list.length) { remindersEl?.remove(); remindersEl = null; return; }
  if (!remindersEl) { remindersEl = h('div', { class: 'reminders' }); document.body.append(remindersEl); }
  const keep = new Set(list.map((r) => `${r.id}:${r.at}`));
  for (const el of [...remindersEl.children]) if (!keep.has(el.dataset.key)) el.remove();
  for (const r of list) {
    const key = `${r.id}:${r.at}`;
    if (remindersEl.querySelector(`[data-key="${CSS.escape(key)}"]`)) continue;
    const act = (action, e) => { if (action === 'done') burstAt(e.currentTarget); api.action('update_reminder', { reminder_id: r.id, action }).then(pollState); };
    remindersEl.append(h('div', { class: 'reminder', 'data-key': key },
      h('div', { class: 'row' }, icon('reminder'), h('b', { text: r.label }), h('span', { class: 'faint', text: U.clock(r.at) })),
      h('div', { class: 'acts' }, kit.btn('Snooze', (e) => act('snooze', e), { kind: 'subtle', icon: 'timer', compact: true }), kit.btn('Done', (e) => act('done', e), { kind: 'primary', icon: 'check', compact: true }))));
  }
}

window.addEventListener('resize', () => { placeNavBar(false); });
boot();
