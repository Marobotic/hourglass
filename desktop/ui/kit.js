// The kit: every control the pages use, in the Marochy look (css/kit.css). Each returns an element; controls that
// hold a value take an onChange and expose .value / .set(v).
import { h, icon, $ } from './dom.js';

// ---- buttons ----
// kind: primary | ghost (default) | subtle | danger; opts: compact, sq (icon only), big, title, disabled, kbd
export function btn(label, onclick, { kind = '', icon: ic, compact, sq, big, title, disabled, kbd, cls = '', type = 'button' } = {}) {
  const classes = ['btn', kind, compact && 'compact', (sq || (!label && ic && !kbd)) && 'sq', big && 'big', cls].filter(Boolean).join(' ');
  return h('button', { class: classes, type, title, disabled, onclick, 'aria-label': !label ? title : null },
    ic ? icon(ic) : null, label ? h('span', { class: 'lbl', text: label }) : null, kbd ? h('span', { class: 'kbd', text: kbd }) : null);
}

export const chip = (text, { tint, cls = '', solid } = {}) => h('span', { class: `chip ${solid ? 'solid' : ''} ${cls}`.trim(), style: tint ? { '--c': tint } : null, text });

export function section(text, detail, ...extra) {
  return h('div', { class: 'section' }, h('span', { text }), detail ? h('small', { text: detail }) : null, ...extra);
}

export function field({ value = '', placeholder = '', type = 'text', oninput, onenter, onchange, autofocus, cls = '', invalid, maxlength } = {}) {
  const el = h('input', { class: `field ${invalid ? 'invalid' : ''} ${cls}`.trim(), type, placeholder, value, autofocus, maxlength, spellcheck: 'false' });
  if (oninput) el.addEventListener('input', () => oninput(el.value));
  if (onchange) el.addEventListener('change', () => onchange(el.value));
  if (onenter) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onenter(el.value); } });
  return el;
}
export function labeled(text, control, hint) {
  return h('label', { class: 'label' }, h('span', { text }), control, hint ? h('small', { class: 'faint', text: hint }) : null);
}
export function search({ value = '', placeholder = 'Search', oninput } = {}) {
  const f = field({ value, placeholder, oninput, type: 'search' });
  const wrap = h('div', { class: 'search' }, icon('search'), f);
  wrap.input = f;
  return wrap;
}

// ---- picker: options [{ label, value, color?, hint? }] ----
export function picker({ options = [], value = null, placeholder = 'Choose', onChange, title = '', width } = {}) {
  const val = h('span', { class: 'val' });
  const sw = h('i', { class: 'swatch' });
  const el = h('button', { class: 'picker', type: 'button', style: width ? { width: `${width}px` } : null }, sw, val, icon('down', 'caret'));
  el.options = options;
  // A <button>'s own value is a string: keep the real one (a number, null, an id) beside it.
  let current = value;
  Object.defineProperty(el, 'value', { get: () => current, set: (v) => { current = v; } });
  const paint = () => {
    const cur = el.options.find((o) => o.value === el.value);
    val.textContent = cur ? cur.label : placeholder;
    val.classList.toggle('none', !cur);
    sw.hidden = !(cur && cur.color);
    if (cur && cur.color) sw.style.setProperty('--c', cur.color);
  };
  el.set = (v) => { el.value = v; paint(); };
  el.setOptions = (o) => { el.options = o; paint(); };
  el.addEventListener('click', async () => {
    el.classList.add('open');
    const r = el.getBoundingClientRect();
    const key = await menu(r.left, r.bottom + 4, title, el.options.map((o) => ({ key: o.value, label: o.label, color: o.color, checked: o.value === el.value, hint: o.hint })), { width: Math.max(r.width, 200) });
    el.classList.remove('open');
    if (key === undefined) return;
    el.set(key);
    onChange?.(key);
  });
  paint();
  return el;
}

// ---- segmented: options [{ label, value, tint? }] ----
export function seg(options, value, onChange, { cls = '' } = {}) {
  const el = h('div', { class: `seg ${cls}`.trim(), role: 'tablist' });
  el.value = value;
  const paint = () => [...el.children].forEach((b, i) => b.classList.toggle('on', options[i].value === el.value));
  for (const o of options) {
    el.append(h('button', { type: 'button', style: o.tint ? { '--c': o.tint } : null, title: o.title, onclick: () => { el.value = o.value; paint(); onChange?.(o.value); } }, o.icon ? icon(o.icon) : null, o.label));
  }
  el.set = (v) => { el.value = v; paint(); };
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = options.findIndex((o) => o.value === el.value);
    const n = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
    el.set(n.value);
    onChange?.(n.value);
    el.children[options.indexOf(n)].focus();
  });
  paint();
  return el;
}

export function toggle(on, onChange, { title } = {}) {
  const el = h('button', { class: `switch ${on ? 'on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(!!on), title });
  let current = !!on;
  Object.defineProperty(el, 'value', { get: () => current, set: (v) => { current = !!v; } });
  el.set = (v) => { el.value = !!v; el.classList.toggle('on', el.value); el.setAttribute('aria-checked', String(el.value)); };
  el.addEventListener('click', (e) => { e.stopPropagation(); el.set(!el.value); onChange?.(el.value); });
  return el;
}

// Seven weekday toggles; days holds ISO numbers (1 = Mon).
export function days(list, onChange, { readOnly = false, small = false } = {}) {
  const el = h('div', { class: `days ${readOnly ? 'ro' : ''} ${small ? 'small' : ''}`.trim() });
  el.value = [...(list || [])];
  'MTWTFSS'.split('').forEach((ch, i) => {
    el.append(h('button', { type: 'button', text: ch, title: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i], class: el.value.includes(i + 1) ? 'on' : '', disabled: readOnly ? true : null,
      onclick: (e) => {
        e.stopPropagation();
        const d = el.value.includes(i + 1) ? el.value.filter((x) => x !== i + 1) : [...el.value, i + 1].sort();
        el.value = d;
        e.currentTarget.classList.toggle('on', d.includes(i + 1));
        onChange?.(d);
      } }));
  });
  return el;
}

export function meter(frac, { cls = '', tint } = {}) {
  const fill = h('i');
  const el = h('div', { class: `meter ${cls}`.trim(), style: tint ? { '--c': tint } : null }, fill);
  el.set = (f) => { fill.style.width = `${Math.max(0, Math.min(1, f || 0)) * 100}%`; };
  requestAnimationFrame(() => el.set(frac));
  return el;
}

// A progress line: a red fill that creeps with the clock and a glowing head (the live class).
export function progress({ thin = false, head = !thin } = {}) {
  const fill = h('i'), dot = head ? h('b') : null;
  const el = h('div', { class: `prog ${thin ? 'thin' : ''}` }, h('div', { class: 'bar' }, fill, dot));
  el.set = (f) => { el.style.setProperty('--p', `${Math.max(0, Math.min(1, f || 0)) * 100}%`); };
  return el;
}
// ---- overlays ----
const stack = []; // open overlays, newest last; Esc closes the newest

export function closeTop() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
export const overlayOpen = () => stack.length > 0;

function leave(el, done) {
  el.classList.add('leaving');
  setTimeout(() => { el.remove(); done?.(); }, 120);
}

// A dialog: title, optional subtitle, body (nodes), footer (nodes). Returns { el, close, body }.
// onClose runs once however it closes; dismissable: Esc and a click outside close it.
export function sheet({ title, subtitle, body = [], footer = [], size = '', onClose, dismissable = true, cls = '' } = {}) {
  const bodyEl = h('div', { class: 'body' }, body);
  const footEl = footer.length ? h('footer', {}, footer) : null;
  const box = h('div', { class: `sheet ${size} ${cls}`.trim(), role: 'dialog', 'aria-modal': 'true' },
    h('header', {}, h('div', { class: 't' }, h('h2', { text: title }), subtitle ? h('p', { text: subtitle }) : null),
      dismissable ? btn('', () => api.close(), { kind: 'subtle', icon: 'close', compact: true, title: 'Close' }) : null),
    bodyEl, footEl);
  const ov = h('div', { class: 'overlay' }, box);
  let closed = false;
  const api = {
    el: box, body: bodyEl, footer: footEl,
    close() {
      if (closed) return;
      closed = true;
      stack.splice(stack.indexOf(api), 1);
      leave(ov);
      onClose?.();
    },
    dismissable,
  };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov && dismissable) api.close(); });
  stack.push(api);
  document.body.append(ov);
  queueMicrotask(() => (box.querySelector('[autofocus]') || box.querySelector('input, textarea') || box.querySelector('footer .btn.primary'))?.focus());
  return api;
}

// The message says what saying yes costs, and the confirm button names the action. Resolves true/false.
export function confirm(title, message, confirmText = 'Delete', { danger = false } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const s = sheet({
      title, size: 'narrow',
      body: [h('p', { class: 'msg', text: message })],
      footer: [h('span', { class: 'grow' }), btn('Cancel', () => s.close()), btn(confirmText, () => { ok = true; s.close(); }, { kind: danger ? 'danger' : 'primary' })],
      onClose: () => resolve(ok),
    });
  });
}

// Ask for one line of text. Resolves the text, or null.
export function prompt(title, { value = '', placeholder = '', confirmText = 'Save', subtitle } = {}) {
  return new Promise((resolve) => {
    let out = null;
    const f = field({ value, placeholder, onenter: () => done(), autofocus: true });
    const done = () => { out = f.value.trim(); s.close(); };
    const s = sheet({ title, subtitle, size: 'narrow', body: [f], footer: [h('span', { class: 'grow' }), btn('Cancel', () => s.close()), btn(confirmText, done, { kind: 'primary' })], onClose: () => resolve(out) });
    queueMicrotask(() => { f.focus(); f.select(); });
  });
}

// Right-click menu: items [{ key, label, icon?, danger?, checked?, disabled?, sub?: [...], separator?, color?, hint? }].
// Opens down-right from (x, y) and flips when there is no room. Resolves the picked key, or undefined.
export function menu(x, y, title, items, { width = 240 } = {}) {
  return new Promise((resolve) => {
    document.querySelectorAll('.menu').forEach((m) => m.close?.());
    const el = h('div', { class: 'menu', role: 'menu', style: { width: `${width}px` } });
    let history = [];
    let picked;
    const render = (list) => {
      el.replaceChildren();
      if (title) el.append(h('div', { class: 'mt', text: title }));
      if (history.length) el.append(h('button', { type: 'button', onclick: () => render(history.pop()) }, h('span', { class: 'lbl muted', text: '‹  Back' })));
      for (const it of list) {
        if (it.separator) { el.append(h('div', { class: 'sep' })); continue; }
        el.append(h('button', { type: 'button', class: it.danger ? 'danger' : '', disabled: it.disabled || null, role: 'menuitem',
          onclick: () => {
            if (it.sub) { history.push(list); render(it.sub); return; }
            picked = it.key;
            close();
          } },
        it.color ? h('i', { class: 'swatch', style: { '--c': it.color } }) : it.icon ? icon(it.icon) : null,
        h('span', { class: 'lbl', text: it.label }),
        it.hint ? h('span', { class: 'sub', text: it.hint }) : null,
        it.checked ? h('span', { class: 'chk', text: '✓' }) : it.sub ? h('span', { class: 'sub', text: '›' }) : null));
      }
    };
    render(items);
    document.body.append(el);
    const r = el.getBoundingClientRect();
    const left = x + r.width > innerWidth - 8 ? Math.max(8, x - r.width) : x;
    const top = y + r.height > innerHeight - 8 ? Math.max(8, y - r.height) : y;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.transformOrigin = `${left < x ? 'right' : 'left'} ${top < y ? 'bottom' : 'top'}`;
    let kb = -1;
    const onKey = (e) => {
      const rows = [...el.querySelectorAll('button:not(:disabled)')];
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        kb = (kb + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
        rows.forEach((b, i) => b.classList.toggle('kb', i === kb));
      } else if (e.key === 'Enter' && rows[kb]) { e.preventDefault(); rows[kb].click(); }
    };
    const onDown = (e) => { if (!el.contains(e.target)) close(); };
    function close() {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', close);
      el.remove();
      resolve(picked);
    }
    el.close = close;
    setTimeout(() => {
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('mousedown', onDown, true);
      window.addEventListener('blur', close);
    });
  });
}
// A menu at an element (below it, right-aligned when asked).
export function menuAt(anchor, title, items, opts = {}) {
  const r = anchor.getBoundingClientRect();
  const width = opts.width || 240;
  return menu(opts.right ? r.right - width : r.left, r.bottom + 4, title, items, { width });
}

// ---- toast: one line at the bottom, ~3.5 s; an optional action ("Undo") ----
export function toast(text, { action, onAction, kind = '' } = {}) {
  const box = $('#toasts');
  for (const t of box.querySelectorAll('.toast')) if (t.dataset.text === text) t.remove();
  while (box.children.length >= 3) box.firstElementChild.remove();
  const el = h('div', { class: `toast ${kind}`.trim(), 'data-text': text }, h('span', { text }), action ? btn(action, () => { onAction?.(); dismiss(); }, { compact: true }) : null);
  let timer;
  const dismiss = () => { clearTimeout(timer); el.classList.add('leaving'); setTimeout(() => el.remove(), 160); };
  const arm = () => { timer = setTimeout(dismiss, action ? 6000 : 3500); };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('click', (e) => { if (!e.target.closest('.btn')) dismiss(); });
  box.append(el);
  arm();
  return dismiss;
}

// ---- tooltips: any [data-tip] element, after 450 ms ----
let tipEl = null, tipTimer = 0;
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest?.('[data-tip]');
  clearTimeout(tipTimer);
  tipEl?.remove();
  tipEl = null;
  if (!t) return;
  tipTimer = setTimeout(() => {
    const r = t.getBoundingClientRect();
    tipEl = h('div', { class: 'tip', text: t.dataset.tip });
    document.body.append(tipEl);
    const w = tipEl.getBoundingClientRect();
    const right = r.right + 10 + w.width < innerWidth;
    tipEl.style.left = `${t.closest('.side') && right ? r.right + 10 : Math.min(innerWidth - w.width - 8, Math.max(8, r.left + r.width / 2 - w.width / 2))}px`;
    tipEl.style.top = `${t.closest('.side') ? r.top + r.height / 2 - w.height / 2 : r.bottom + 6}px`;
  }, 450);
});
document.addEventListener('mousedown', () => { clearTimeout(tipTimer); tipEl?.remove(); tipEl = null; });
