// The window's own frame: minimize / maximize / close at the right end of the top bar (the native title bar is off),
// a drag region for the bar and the sidebar's logo row, and invisible edge handles so the undecorated window still
// resizes. Looks and behaves like Jukebox's. In a plain browser (dev) the buttons do nothing.
import { h } from './dom.js';

const T = globalThis.__TAURI__;
const win = T?.window?.getCurrentWindow?.();

// The art is drawn on an 18-unit grid and shown at 18 px, so one unit is one screen pixel: 2 px square-capped
// strokes on whole coordinates land exactly on pixels.
const svg = (cls, body) => `<svg class="${cls}" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${body}</svg>`;
const ART = {
  min: svg('w-min', '<path d="M4 9h10"/>'),
  max: svg('w-max', '<path d="M4 4h10v10H4z"/>') + svg('w-restore', '<path d="M7 7V3h8v8h-4"/><path d="M3 7h8v8H3z"/>'),
  close: svg('w-close', '<path d="M4 4l10 10M14 4L4 14"/>'),
};
const LABEL = { min: 'Minimize', max: 'Maximize', close: 'Close' };

// Three buttons; every cluster on screen follows the window's maximize state.
export function windowControls() {
  const btn = (a) => h('button', { class: `wbtn ${a === 'close' ? 'wclose' : ''}`, type: 'button', 'data-win': a, 'aria-label': LABEL[a], 'data-tip': LABEL[a], html: ART[a],
    onclick: () => {
      if (!win) return;
      if (a === 'min') win.minimize().catch(() => {});
      else if (a === 'max') win.toggleMaximize().then(syncMax).catch(() => {});
      else win.close().catch(() => {});
    } });
  return h('div', { class: 'wctl' }, btn('min'), btn('max'), btn('close'));
}

// A drag region is the element itself, not its children: mark the bar and its plain text/gap elements.
export function dragRegion(...els) { for (const el of els) if (el) el.setAttribute('data-tauri-drag-region', ''); return els[0]; }

function syncMax() {
  win?.isMaximized().then((m) => {
    document.body.classList.toggle('maxed', m);
    for (const b of document.querySelectorAll('[data-win]')) {
      b.classList.toggle('maximized', m);
      if (b.dataset.win === 'max') { const t = m ? 'Restore' : 'Maximize'; b.setAttribute('aria-label', t); b.dataset.tip = t; }
    }
  }).catch(() => {});
}

if (win) {
  // Alt+F4: with no native frame the page can hold the key, so it closes the window the way the X does
  // (the window hides to the tray; Quit in the tray menu ends the app).
  addEventListener('keydown', (e) => { if (e.altKey && e.key === 'F4') { e.preventDefault(); win.close().catch(() => {}); } });
  // Edge handles: the page covers the whole window, so the native frame can't reach the edges.
  const rz = h('div', { id: 'rz' }, ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'].map((d) => h('div', {
    class: `rz rz-${d}`,
    onmousedown: (e) => { if (e.button !== 0) return; e.preventDefault(); win.startResizeDragging(d).catch(() => {}); },
  })));
  document.body.append(rz);
  // Double-click, snapping and the keyboard change the state without the button, so the glyph follows the window.
  let t = 0;
  win.onResized?.(() => { clearTimeout(t); t = setTimeout(syncMax, 80); });
  syncMax();
}
