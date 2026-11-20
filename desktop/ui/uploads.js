// The upload panel, bottom right (UploadPanel.qml): each file going up with its progress and speed; cancel one;
// close the panel when they're done. Polls the service's /api/uploads while anything is in flight.
import { h, icon, swap } from './dom.js';
import { api } from './api.js';
import * as U from './util.js';

export function startUploadPanel() {
  let items = [];
  let open = false;
  let timer = 0;
  const el = h('div', { class: 'uploads', hidden: true });
  document.body.append(el);

  async function poll() {
    const d = await api.get('/api/uploads', { quiet: true }).catch(() => null);
    if (d) items = d;
    const going = items.some((u) => u.state === 'sending' || u.state === 'waiting');
    if (going || api.uploading > 0) open = true;
    render();
    clearTimeout(timer);
    if (going || api.uploading > 0) timer = setTimeout(poll, 700);
  }
  async function close() {
    await api.del('/api/uploads', { readOnly: true, quiet: true }).catch(() => {});
    items = [];
    open = false;
    render();
  }

  function title() {
    const sending = items.filter((u) => u.state === 'sending');
    if (sending.length) {
      let a = 0, b = 0;
      for (const u of sending) { a += u.sent; b += u.size; }
      return `Uploading ${U.plural(sending.length, 'file')} · ${b ? Math.round(a * 100 / b) : 0}%`;
    }
    const done = items.filter((u) => u.state === 'done').length, bad = items.filter((u) => u.state === 'failed' || u.state === 'cancelled').length;
    return [done ? `${U.plural(done, 'upload')} complete` : '', bad ? `${bad} not uploaded` : ''].filter(Boolean).join(' · ') || 'Uploads';
  }

  function render() {
    el.hidden = !open || (!items.length && api.uploading === 0);
    if (el.hidden) return;
    const waiting = Math.max(0, api.uploading - items.filter((u) => u.state === 'sending').length);
    swap(el,
      h('div', { class: 'up-head' }, h('b', { class: 'grow', text: title() }),
        h('button', { class: 'btn subtle compact sq', title: 'Close', onclick: close }, icon('close'))),
      waiting > 0 ? h('div', { class: 'up-wait faint', text: waiting === 1 ? '1 file getting ready…' : `${waiting} files getting ready…` }) : null,
      h('div', { class: 'up-list' }, items.slice(-30).reverse().map((u) => {
        const going = u.state === 'sending';
        const frac = u.state === 'done' ? 1 : u.size ? u.sent / u.size : 0;
        const line = going && u.sent >= u.size ? `${U.bytes(u.size)}  ·  finishing…`
          : going ? `${U.bytes(u.sent)} of ${U.bytes(u.size)}${u.speed > 0 ? `  ·  ${U.bytes(u.speed)}/s` : ''}`
            : u.state === 'done' ? `${U.bytes(u.size)}  ·  uploaded` : u.state === 'cancelled' ? 'Cancelled' : u.error || 'Not uploaded';
        return h('div', { class: 'up-row' },
          icon(/\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(u.name) ? 'image' : 'file', 'muted'),
          h('div', { class: 'col grow' }, h('span', { class: 'ellipsis', text: u.name }),
            h('div', { class: 'meter thin', style: { '--c': u.state === 'done' ? 'var(--teal)' : going ? 'var(--accent)' : 'var(--faint)' } }, h('i', { style: { width: `${frac * 100}%` } })),
            h('small', { class: u.state === 'failed' ? 'overdue' : 'muted', text: line })),
          going ? h('button', { class: 'btn subtle compact sq', title: 'Cancel this upload', onclick: () => api.post(`/api/uploads/${u.id}/cancel`, {}, { readOnly: true }).then(poll) }, icon('close'))
            : u.state === 'done' ? icon('check', 'ok-ink') : h('span'));
      })));
  }

  // Any upload starting (api.uploading goes up) opens the panel.
  let last = 0;
  setInterval(() => { if (api.uploading !== last) { last = api.uploading; if (api.uploading > 0) poll(); } }, 300);
  return { poll };
}
