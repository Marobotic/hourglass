// Small DOM helpers shared by every page: the element builder (Metro's h()), Nerd Font icons and the logo.

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

// Nerd Font (Font Awesome range) glyphs by name, the same set the Qt window used (Icon.qml).
export const GLYPHS = {
  'now': '\u{f017}', 'week': '\u{f073}', 'courses': '\u{f07b}', 'time': '\u{f252}', 'plus': '\u{f067}', 'search': '\u{f002}',
  'pin': '\u{f08d}', 'place': '\u{f041}', 'trash': '\u{f1f8}', 'edit': '\u{f040}', 'close': '\u{f00d}', 'check': '\u{f00c}',
  'play': '\u{f04b}', 'pause': '\u{f04c}', 'stop': '\u{f04d}', 'left': '\u{f053}', 'right': '\u{f054}', 'note': '\u{f249}',
  'bell': '\u{f0f3}', 'bell-off': '\u{f1f6}', 'reminder': '\u{f0a2}', 'sync': '\u{f021}', 'cloud': '\u{f0c2}', 'person': '\u{f007}',
  'back': '\u{f060}', 'eye': '\u{f06e}', 'code': '\u{f121}', 'bolt': '\u{f0e7}', 'folder-open': '\u{f07c}', 'calendar-plus': '\u{f271}',
  'list': '\u{f03a}', 'timer': '\u{f254}', 'down': '\u{f078}', 'gear': '\u{f013}', 'globe': '\u{f0ac}', 'bold': '\u{f032}',
  'italic': '\u{f033}', 'underline': '\u{f0cd}', 'strike': '\u{f0cc}', 'list-ul': '\u{f0ca}', 'list-ol': '\u{f0cb}',
  'heading': '\u{f1dc}', 'image': '\u{f03e}', 'clip': '\u{f0c6}', 'folder': '\u{f07b}', 'file': '\u{f15b}', 'upload': '\u{f093}',
  'download': '\u{f019}', 'check-square': '\u{f14a}', 'chat': '\u{f086}', 'send': '\u{f1d8}', 'drive': '\u{f0a0}',
  'user-check': '\u{f4fc}', 'grid': '\u{f00a}', 'gallery': '\u{f009}', 'up': '\u{f077}', 'sort-up': '\u{f0de}',
  'sort-down': '\u{f0dd}', 'link': '\u{f0c1}', 'share': '\u{f1e0}', 'move': '\u{f047}', 'font': '\u{f031}', 'text-size': '\u{f034}',
  'volume': '\u{f028}', 'paper-plane': '\u{f1d8}', 'spark': '\u{f005}', 'more': '\u{f141}', 'copy': '\u{f0c5}', 'quote': '\u{f10d}',
  'undo': '\u{f0e2}', 'redo': '\u{f01e}', 'arrow-down': '\u{f063}', 'arrow-up': '\u{f062}', 'arrow-right': '\u{f061}',
  'calendar': '\u{f133}', 'clock': '\u{f017}', 'history': '\u{f1da}', 'external': '\u{f08e}', 'lock': '\u{f023}', 'key': '\u{f084}',
  'sun': '\u{f185}', 'moon': '\u{f186}', 'circle': '\u{f111}', 'square': '\u{f0c8}', 'square-o': '\u{f096}', 'info': '\u{f129}',
  'warning': '\u{f071}', 'magic': '\u{f0d0}', 'tasks': '\u{f0ae}', 'sliders': '\u{f1de}', 'power': '\u{f011}', 'music': '\u{f001}',
  'video': '\u{f03d}', 'file-pdf': '\u{f1c1}', 'file-text': '\u{f15c}', 'file-code': '\u{f1c9}', 'file-zip': '\u{f1c6}',
  'refresh': '\u{f021}', 'filter': '\u{f0b0}', 'star': '\u{f005}', 'command': '\u{f120}', 'expand': '\u{f065}', 'minus': '\u{f068}',
};

export const icon = (name, cls = '') => h('i', { class: `ic ${cls}`.trim(), 'aria-hidden': 'true', text: GLYPHS[name] ?? '' });

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
