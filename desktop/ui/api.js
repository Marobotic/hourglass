// Talks to the local service (hourglassd). Every call is a promise; errors also go to the error listeners so the
// window can toast them instead of failing silently. A port of the Qt window's Api.qml.

const listeners = { error: new Set(), changed: new Set() };

export const api = {
  base: 'http://127.0.0.1:8931',
  token: '',
  revision: 0, // bumped after every successful change
  uploading: 0, // uploads in flight (the window warns before quitting with one running)
  on(ev, fn) { listeners[ev].add(fn); return () => listeners[ev].delete(fn); },
  emit(ev, ...a) { for (const fn of [...listeners[ev]]) { try { fn(...a); } catch (e) { console.error(e); } } },

  // Read-only actions are POSTs too; they must not announce a change, or every page reloads, re-posts, and the
  // window spins in a loop.
  reads: ['whats_now', 'world_clock', 'get_schedule', 'list_courses', 'get_notes', 'search_notes', 'list_alarms', 'list_timers', 'note_versions', 'get_attendance', 'list_drive', 'list_reminders'],

  // { quiet: true } keeps errors out of the toast; { readOnly } marks a POST that changes nothing.
  async request(method, path, body, { readOnly = false, quiet = false, signal, raw = false } = {}) {
    const upload = path === '/api/files/upload';
    if (upload) this.uploading++;
    try { return await this.send(method, path, body, { readOnly, quiet, signal, raw }); } finally { if (upload) this.uploading--; }
  },
  async send(method, path, body, { readOnly, quiet, signal, raw }) {
    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        signal,
        headers: { authorization: `Bearer ${this.token}`, ...(body != null ? { 'content-type': 'application/json' } : {}) },
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      const err = Object.assign(new Error('Hourglass service is not running'), { status: 0 });
      if (method !== 'GET' && !quiet) this.emit('error', err.message);
      throw err;
    }
    if (raw) return res;
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (res.ok) {
      if (method !== 'GET' && !readOnly) { this.revision++; touchLocal(); this.emit('changed'); }
      return data;
    }
    const msg = data && data.error ? data.error : `HTTP ${res.status}`;
    // A read that couldn't reach the server is mostly a page refreshing itself: the sidebar already says
    // "Offline, saved here", so no toast. A cancelled upload (499) shows as cancelled in the upload panel.
    const loud = (method !== 'GET' && res.status !== 499) || (method === 'GET' && res.status < 502);
    if (!quiet && loud) this.emit('error', msg);
    throw Object.assign(new Error(msg), { status: res.status, data });
  },
  get(path, o) { return this.request('GET', path, null, o); },
  post(path, body, o) { return this.request('POST', path, body || {}, o); },
  put(path, body, o) { return this.request('PUT', path, body, o); },
  patch(path, body, o) { return this.request('PATCH', path, body, o); },
  del(path, o) { return this.request('DELETE', path, null, o); },
  action(name, args, o) { return this.request('POST', '/api/actions/' + name, args || {}, { readOnly: this.reads.includes(name), ...o }); },
  // A service URL the page can put in <img src> (the service hands out /files/<id>?k=... paths).
  abs(u) { return !u ? '' : /^(https?|data|blob|asset):/.test(u) ? u : this.base + (u.startsWith('/') ? u : '/' + u); },
};

// Changes this window just made don't glow (see glow() in app.js): only changes from elsewhere do.
let localUntil = 0;
export function touchLocal() { localUntil = Date.now() + 4000; }
export const isLocal = () => Date.now() < localUntil;
