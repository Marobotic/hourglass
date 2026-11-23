// Small DOM helpers shared by every page: the element builder (Metro's h()), the line icons and the logo.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v; // only for our own markdown renderer and SVG
    else if (k === 'ref') v(el);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) if (sv != null) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    } else if (k === 'value' && 'value' in el) el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// Square-cap 24 px line icons drawn for Hourglass (docs/redesign5 parts.mjs): 1.75 stroke, miter joins, so they sit
// with the square UI. Sized in em (1.25em), so a context's font-size sets them. Paths with class "f" are filled.
const D = {
  now: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  schedule: '<path d="M3.5 5.5h17v15h-17z M3.5 10h17 M8 3v4 M16 3v4"/><path class="f" d="M7 13h2.5v2.5H7z M11 13h2.5v2.5H11z M15 13h2.5v2.5H15z M7 16.5h2.5V19H7z"/>',
  notes: '<path d="M5 3.5h10l4 4v13H5z M15 3.5v4h4 M8.5 11.5h7 M8.5 15h7 M8.5 18h4"/>',
  drive: '<path d="M3.5 6h6l2 2.5h9v11h-17z M3.5 11h17"/>',
  time: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 1.5 M3.5 6l3.5-3 M20.5 6l-3.5-3 M7 19.5l-1.5 2 M17 19.5l1.5 2"/>',
  assistant: '<path d="M4 4.5h16v11H11l-4.5 4v-4H4z"/><path class="f" d="M12 6.8l.95 2.3 2.3.95-2.3.95L12 13.3l-.95-2.3-2.3-.95 2.3-.95z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8l1.7 2.4 2.9-.7.6 2.9 2.5 1.6-1.4 2.6 1.4 2.6-2.5 1.6-.6 2.9-2.9-.7L12 21.2l-1.7-2.4-2.9.7-.6-2.9-2.5-1.6L5.7 12 4.3 9.4l2.5-1.6.6-2.9 2.9.7z"/>',
  plus: '<path d="M12 5v14 M5 12h14"/>',
  minus: '<path d="M6 12h12"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  pin: '<path d="M9 3.5h6 M10 3.5v5.5l-3 4h10l-3-4V3.5 M12 13v7.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11 M17.5 6.5l-11 11"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>', right: '<path d="M9.5 6l6 6-6 6"/>', down: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>', up: '<path d="M6.5 14.5L12 9l5.5 5.5"/>',
  back: '<path d="M19 12H5 M11 6l-6 6 6 6"/>',
  arrow: '<path d="M4.5 12h15 M13.5 6l6 6-6 6"/>',
  'arrow-up': '<path d="M12 19.5V5 M6 11l6-6 6 6"/>', 'arrow-down': '<path d="M12 4.5V19 M6 13l6 6 6-6"/>',
  more: '<path class="f" d="M4.5 10.75h2.5v2.5H4.5z M10.75 10.75h2.5v2.5h-2.5z M17 10.75h2.5v2.5H17z"/>',
  place: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><path d="M10 8h4v4h-4z"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5"/>',
  usercheck: '<circle cx="9.5" cy="8" r="3.5"/><path d="M3 20c.8-3.8 3.5-5.5 6.5-5.5 1.2 0 2.3.2 3.3.7 M14.5 17.5l2.2 2.2 4.3-4.7"/>',
  timer: '<path d="M6.5 3.5h11 M6.5 20.5h11 M7.5 3.5c0 4 4.5 5.5 4.5 8.5s-4.5 4.5-4.5 8.5 M16.5 3.5c0 4-4.5 5.5-4.5 8.5s4.5 4.5 4.5 8.5"/><path class="f" d="M9.5 18.5h5l-2.5-3z"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z M10 21h4"/>',
  'bell-off': '<path d="M8 6.2A6 6 0 0 1 18 11v4 M6 11v5.5l-1.5 2H16 M10 21h4 M3.5 3.5l17 17"/>',
  reminder: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z M10 21h4"/><path class="f" d="M17.5 2.5h4v4h-4z"/>',
  skip: '<path d="M5.5 6l8.5 6-8.5 6z M17.5 6v12"/>',
  undo: '<path d="M9 6.5L4.5 11 9 15.5 M5 11h9.5a5 5 0 0 1 0 10H11"/>',
  redo: '<path d="M15 6.5l4.5 4.5-4.5 4.5 M19 11H9.5a5 5 0 0 0 0 10H13"/>',
  clip: '<path d="M16.5 7.5l-7 7a2 2 0 0 0 2.8 2.8l7.4-7.4a4 4 0 0 0-5.7-5.7L6.6 11.6a6 6 0 0 0 8.5 8.5l5.4-5.4"/>',
  stop: '<path class="f" d="M7 7h10v10H7z"/>',
  play: '<path class="f" d="M7 4.5l12 7.5-12 7.5z"/>',
  pause: '<path class="f" d="M7 5h3.5v14H7z M13.5 5H17v14h-3.5z"/>',
  edit: '<path d="M4 20h4.5L19.5 9 15 4.5 4 15.5z M13 6.5l4.5 4.5"/>',
  bold: '<path d="M7 4.5h6a3.5 3.5 0 0 1 0 7H7z M7 11.5h7a3.75 3.75 0 0 1 0 7.5H7z"/>',
  italic: '<path d="M10 4.5h8 M6 19.5h8 M14.5 4.5l-5 15"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4 M5 20.5h14"/>',
  strike: '<path d="M4.5 12h15 M16.5 7.5c-.5-2-2.2-3-4.5-3-2.8 0-4.5 1.4-4.5 3.4 0 1.4.8 2.4 2.5 3 M7.5 16.3c.5 2 2.2 3.2 4.6 3.2 2.8 0 4.6-1.4 4.6-3.5 0-.9-.3-1.6-.9-2.1"/>',
  heading: '<path d="M6 4.5v15 M17 4.5v15 M6 12h11"/>',
  list: '<path d="M10 6.5h10 M10 12h10 M10 17.5h10"/><path class="f" d="M4 5.25h2.5v2.5H4z M4 10.75h2.5v2.5H4z M4 16.25h2.5v2.5H4z"/>',
  'list-ol': '<path d="M10 6.5h10 M10 12h10 M10 17.5h10 M4.5 4.5h1.5v4 M4 14.5h2.5v1.5l-2.5 2v1h3"/>',
  checklist: '<path d="M11 7h9 M11 17h9 M3.5 6.5l2 2 3.5-4"/><path d="M4 14.5h4.5V19H4z"/>',
  image: '<path d="M3.5 4.5h17v15h-17z M3.5 16l5-5 4 4 2.5-2.5 5.5 5.5"/><path d="M14.5 8h2.5v2.5h-2.5z"/>',
  sync: '<path d="M19.5 9A8 8 0 0 0 5 7.5 M4.5 3.5v4.5H9 M4.5 15A8 8 0 0 0 19 16.5 M19.5 20.5V16H15"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17 M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z"/>',
  trash: '<path d="M4.5 6.5h15 M9.5 6.5v-3h5v3 M6.5 6.5l1 14h9l1-14 M10.5 10.5v6 M13.5 10.5v6"/>',
  attend: '<path d="M3.5 5.5h17v15h-17z M3.5 10h17 M8 3v4 M16 3v4 M8.5 15l2.5 2.5 4.5-5"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3 M4.5 3.5v3.7h3.7 M12 8v4.5l3 1.5"/>',
  link: '<path d="M10 14l4-4 M8.5 11L6 13.5a3.2 3.2 0 0 0 4.5 4.5l2.5-2.5 M15.5 13l2.5-2.5A3.2 3.2 0 0 0 13.5 6L11 8.5"/>',
  mic: '<path d="M9 3.5h6v10H9z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5v3"/>',
  filter: '<path d="M4 5.5h16 M7 12h10 M10 18.5h4"/>',
  spark: '<path class="f" d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  flag: '<path d="M5.5 21V4 M5.5 4.5h12l-2.5 4 2.5 4h-12"/>',
  warning: '<path d="M12 3.5l9 16H3z M12 10v4.5"/><path class="f" d="M11 16.5h2V18.5h-2z"/>',
  volume: '<path d="M4 9.5h4l5-4v13l-5-4H4z M16.5 9a4 4 0 0 1 0 6 M19 6.5a7.5 7.5 0 0 1 0 11"/>',
  coffee: '<path d="M4.5 9.5h12v6a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z M16.5 11h1.5a2.5 2.5 0 0 1 0 5h-1.5 M8 3.5v3 M12 3.5v3"/>',
  folder: '<path d="M3.5 5.5h6l2 2.5h9v11.5h-17z"/>',
  'folder-open': '<path d="M3.5 19.5v-14h6l2 2.5h7v3 M3.5 19.5l3-8.5h15l-3 8.5z"/>',
  file: '<path d="M5.5 3.5h9l4 4v13h-13z M14.5 3.5v4h4"/>',
  'file-text': '<path d="M5.5 3.5h9l4 4v13h-13z M14.5 3.5v4h4 M8.5 12h7 M8.5 15.5h7"/>',
  'file-code': '<path d="M5.5 3.5h9l4 4v13h-13z M14.5 3.5v4h4 M10 11.5l-2 2.5 2 2.5 M14 11.5l2 2.5-2 2.5"/>',
  'file-zip': '<path d="M5.5 3.5h9l4 4v13h-13z M14.5 3.5v4h4 M10.5 3.5v2h2v2h-2v2h2v2h-2"/><path d="M10 14h3v3.5h-3z"/>',
  'file-pdf': '<path d="M5.5 3.5h9l4 4v13h-13z M14.5 3.5v4h4"/><path class="f" d="M8 12.5h8v1.5H8z M8 15.5h5v1.5H8z"/>',
  video: '<path d="M3.5 6.5h12v11h-12z M15.5 10.5l5-3v9l-5-3z"/>',
  music: '<path d="M9 17.5V5.5l11-2v12 M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M20 15.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/>',
  upload: '<path d="M12 15V4 M7 8.5l5-5 5 5 M4.5 15v5h15v-5"/>',
  download: '<path d="M12 4v11 M7 10.5l5 5 5-5 M4.5 15v5h15v-5"/>',
  external: '<path d="M13.5 4.5h6v6 M19.5 4.5l-9 9 M17.5 13.5v6h-13v-13h6"/>',
  share: '<path d="M6.5 9.5h3 M14.5 6.5l-5 3.5 5 3.5"/><path d="M15 3.5h4.5V8H15z M4.5 8H9v4.5H4.5z M15 14h4.5v4.5H15z"/>',
  copy: '<path d="M8.5 8.5h11v11h-11z M15.5 8.5v-4h-11v11h4"/>',
  move: '<path d="M12 3.5v17 M3.5 12h17 M9 6.5l3-3 3 3 M9 17.5l3 3 3-3 M6.5 9l-3 3 3 3 M17.5 9l3 3-3 3"/>',
  grid: '<path d="M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z"/>',
  gallery: '<path d="M3.5 4.5h17v15h-17z M3.5 15l5-4.5 4 3.5 3-2.5 5 4"/>',
  'sort-up': '<path d="M12 19V6 M7 10.5L12 5.5l5 5"/>', 'sort-down': '<path d="M12 5v13 M7 13.5l5 5 5-5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  code: '<path d="M8.5 7l-5 5 5 5 M15.5 7l5 5-5 5"/>',
  bolt: '<path d="M13.5 3l-8 11h6l-1 7 8-11h-6z"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5 3.75 3.75 0 0 1-.5 7.5z"/>',
  chat: '<path d="M4 4.5h16v11H11l-4.5 4v-4H4z"/>',
  send: '<path d="M3.5 11.5l17-7.5-7 17-2.5-7z M11 14l9.5-10"/>',
  font: '<path d="M5 20l6-16h2l6 16 M7.5 14h9"/>',
  'text-size': '<path d="M3 7.5V5h11v2.5 M8.5 5v14 M13 12.5V11h8v1.5 M17 11v8"/>',
  quote: '<path class="f" d="M5 7h5v5H7.5L6 17H4.5l1.5-5H5z M14 7h5v5h-2.5L15 17h-1.5l1.5-5H14z"/>',
  calendar: '<path d="M3.5 5.5h17v15h-17z M3.5 10h17 M8 3v4 M16 3v4"/>',
  'calendar-plus': '<path d="M3.5 5.5h17v15h-17z M3.5 10h17 M8 3v4 M16 3v4 M12 12.5v6 M9 15.5h6"/>',
  lock: '<path d="M5.5 10.5h13v10h-13z M8.5 10.5v-3a3.5 3.5 0 0 1 7 0v3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5 M16 7l2.5 2.5 M14 9l2 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5 M12 19v2.5 M2.5 12H5 M19 12h2.5 M5.3 5.3l1.8 1.8 M16.9 16.9l1.8 1.8 M5.3 18.7l1.8-1.8 M16.9 7.1l1.8-1.8"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  circle: '<circle cx="12" cy="12" r="7"/>',
  square: '<path class="f" d="M5 5h14v14H5z"/>',
  'square-o': '<path d="M5 5h14v14H5z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 10.5v6"/><path class="f" d="M11 7h2v2h-2z"/>',
  magic: '<path d="M4 20L15 9 M13 7l2-2 4 4-2 2z"/><path class="f" d="M7 3l.7 1.8L9.5 5.5l-1.8.7L7 8l-.7-1.8-1.8-.7 1.8-.7z M19 14l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
  sliders: '<path d="M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 4.5v5h4v-5z M6 14.5v5h4v-5z"/>',
  power: '<path d="M12 3.5v8 M7 6.2a7.5 7.5 0 1 0 10 0"/>',
  refresh: '<path d="M19.5 9A8 8 0 0 0 5 7.5 M4.5 3.5v4.5H9 M4.5 15A8 8 0 0 0 19 16.5 M19.5 20.5V16H15"/>',
  star: '<path d="M12 3.5l2.6 5.5 6 .7-4.4 4.1 1.2 6-5.4-3-5.4 3 1.2-6L3.4 9.7l6-.7z"/>',
  command: '<path d="M4.5 6.5l5 5.5-5 5.5 M11.5 18h8"/>',
  expand: '<path d="M14 4.5h5.5V10 M19.5 4.5l-6 6 M10 19.5H4.5V14 M4.5 19.5l6-6"/>',
};
// The app's names for the same drawings.
const ALIAS = {
  week: 'schedule', courses: 'folder', note: 'notes', close: 'x', 'list-ul': 'list', 'check-square': 'checklist', 'user-check': 'usercheck',
  'arrow-right': 'arrow', 'paper-plane': 'send', clock: 'now', tasks: 'checklist',
};
export const ICONS = Object.keys(D).concat(Object.keys(ALIAS));
export const hasIcon = (name) => !!(D[name] || D[ALIAS[name]]);
export function icon(name, cls = '') {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('class', `ic ${cls}`.trim());
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = D[name] || D[ALIAS[name]] || '';
  return el;
}

// The pixel hourglass, drawn from the same grid as Logo.qml: accent frame, gold sand, and (alive) a grain falling.
const ROWS = ['#########', '.#.....#.', '.#ooooo#.', '..#ooo#..', '...#o#...', '...#o#...', '..#.o.#..', '.#.ooo.#.', '.#ooooo#.', '#########'];
export function logo(cell = 3, { alive = false, cls = '' } = {}) {
  const w = ROWS[0].length, ht = ROWS.length;
  let rects = '';
  ROWS.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === '.') return;
    rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="var(--${ch === 'o' ? 'gold' : 'accent'})"/>`;
  }));
  if (alive) rects += '<rect class="grain" x="4" y="4" width="1" height="1" fill="color-mix(in srgb, var(--gold) 60%, white)"/>';
  const el = h('span', { class: `logo ${cls}`.trim(), html: `<svg width="${w * cell}" height="${ht * cell}" viewBox="0 0 ${w} ${ht}" shape-rendering="crispEdges">${rects}</svg>` });
  return el;
}

// Replace a container's children, keeping its scroll position.
export function swap(el, ...children) {
  const top = el.scrollTop;
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  el.scrollTop = top;
}

// One frame later (after layout), for animations that need a start state.
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

// A pixel burst for finishing things (Motion.burstAt in the Qt window).
export function burst(x, y) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['var(--gold)', 'var(--accent)', 'var(--fg)', 'var(--teal)'];
  for (let i = 0; i < 16; i++) {
    const a = Math.PI * 2 * i / 16 + Math.random() * 0.5, v = 40 + Math.random() * 70, size = 3 + Math.round(Math.random() * 4);
    const p = h('i', { class: 'burst', style: { left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px`, background: colors[i % 4] } });
    document.body.append(p);
    p.animate([
      { transform: 'translate(0,0)', opacity: 1 },
      { transform: `translate(${Math.cos(a) * v * 0.6}px, ${Math.sin(a) * v - 30}px)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${Math.cos(a) * v * 1.15}px, ${Math.sin(a) * v + 40}px)`, opacity: 0 },
    ], { duration: 850, easing: 'cubic-bezier(.2,0,0,1)' }).onfinish = () => p.remove();
  }
}
export function burstAt(el) {
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2);
}
