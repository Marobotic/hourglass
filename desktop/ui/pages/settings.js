// Settings: time, alarms and ringtones, the assistant, the AI link, the account, and this app (SettingsPage.qml).
// Ringtones and the chosen one sync to every device.
import { h, icon, swap } from '../dom.js';
import { pickFiles, copy } from '../native.js';

export default {
  mount(root, ctx) {
    const { api, state, U, kit } = ctx;
    let account = {};
    let tones = [];
    let ai = null;
    let busy = false;
    let testNote = '';
    let history = null;
    let update = null;
    const body = h('div', { class: 'page-col settings' });
    root.append(ctx.head({ title: 'Settings' }), h('div', { class: 'page' }, body));

    const set = (patch) => api.put('/api/settings', patch).then(() => { ctx.pollState(); load(); }).catch(() => {});
    const s = () => state.settings || {};

    // A setting: its name and hint, then its controls.
    const row = (label, hint, ...controls) => h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('b', { text: label }), hint ? h('small', { class: 'muted', text: hint }) : null), h('div', { class: 'set-c' }, controls));

    async function load() {
      const [a, t] = await Promise.all([api.get('/api/account', { quiet: true }).catch(() => null), api.get('/api/ringtones', { quiet: true }).catch(() => null)]);
      if (a) account = a;
      if (t) tones = t;
      render();
    }
    async function aiLoad(make) {
      try { ai = await api.request(make ? 'POST' : 'GET', '/api/ai', make ? {} : null, { readOnly: true, quiet: !make }); } catch { /* signed out or offline */ }
      render();
    }
    async function uploadTone() {
      const [path] = await pickFiles({ title: 'Choose an audio file', filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac'] }] });
      if (!path) return;
      busy = true; render();
      try { await api.post('/api/ringtones/upload', { path }); kit.toast('Ringtone added'); } catch {}
      busy = false; ctx.pollState(); load();
    }

    function toneRow(t) {
      const kind = t.kind === 'builtin' ? 'Built in' : t.kind === 'song' ? 'Song' + (t.artist ? ' · ' + t.artist : '') : 'Upload';
      return h('div', { class: `tone ${t.selected ? 'on' : ''}`, onclick: () => set({ ringtone: t.id }) },
        h('i', { class: 'radio' }), h('span', { class: 'ellipsis tone-name', text: t.name }), h('small', { class: 'muted grow ellipsis', text: kind + (t.ready === false ? ' · downloading…' : '') }),
        kit.btn('', (e) => { e.stopPropagation(); api.post('/api/ring/preview?name=' + encodeURIComponent(t.id), {}, { readOnly: true }); }, { kind: 'subtle', icon: 'play', compact: true, title: 'Play', disabled: t.ready === false }),
        t.kind !== 'builtin' ? kit.btn('', async (e) => {
          e.stopPropagation();
          if (await kit.confirm(`Delete ${t.name}?`, 'It is removed from every device.' + (t.selected ? ' Alarms go back to Classic.' : ''), 'Delete', { danger: true })) api.del('/api/ringtones/' + t.id).then(load);
        }, { kind: 'subtle', icon: 'trash', compact: true, title: 'Delete' }) : null);
    }

    function historyBlock() {
      if (!history) return null;
      if (!history.length) return h('div', { class: 'quiet', text: 'Nothing has rung on this computer yet.' });
      return h('div', { class: 'ring-history' }, history.slice(0, 60).map((e) => {
        const broke = e.event === 'broke' || e.event === 'no sound';
        return h('div', { class: 'rh' }, h('div', { class: 'row' }, h('small', { class: 'muted grow', text: U.shortDate(U.dayOf(e.at)) + ' ' + U.clock(e.at) }), h('small', { class: broke ? 'rh-ev broke' : 'rh-ev', text: String(e.event).toUpperCase() })),
          h('span', { class: 'ellipsis', text: e.label }), e.detail ? h('small', { class: broke ? 'overdue' : 'faint', text: e.detail }) : null);
      }));
    }

    function render() {
      const sync = state.app.sync || {};
      const signedIn = !!account.signed_in;
      const mcp = ai?.mcp_url;
      swap(body,
        h('section', {}, kit.section('Time'),
          row('Clock', '', kit.seg([{ label: '12-hour', value: '12h' }, { label: '24-hour', value: '24h' }], s().time_format === '24h' ? '24h' : '12h', (v) => set({ time_format: v }))),
          row('Week starts on', '', kit.seg([{ label: 'Saturday', value: 6 }, { label: 'Sunday', value: 7 }, { label: 'Monday', value: 1 }], s().week_start || 6, (v) => set({ week_start: v }))),
          row('Time zone', 'The app\'s time zone, the same on every device. Change it from the world clock.', kit.btn('World clock', () => ctx.go('world'), { icon: 'globe' }))),
        h('section', {}, kit.section('Alarms'),
          row('Lecture reminders', 'Rings before every lecture, on all your devices.', kit.seg([0, 10, 15, 30, 60].map((m) => ({ label: m ? `${m} min` : 'Off', value: m })), s().lecture_reminder_min || 0, (v) => set({ lecture_reminder_min: v }))),
          row('Ringtone', 'Rings on every device. Upload an audio file or pick a song in Jukebox: Set as alarm.', kit.btn(busy ? 'Uploading…' : 'Upload audio file', uploadTone, { icon: 'folder-open', disabled: busy || !signedIn })),
          tones.length ? h('div', { class: 'tones' }, tones.map(toneRow)) : null,
          row('Alarm sound', 'Off: alarms still show a notification.', kit.seg([{ label: 'On', value: true }, { label: 'Off', value: false }], s().sound !== false, (v) => set({ sound: v }))),
          row('Test alarm', testNote || 'Rings right now like a real alarm: the notification, your ringtone and the alarm screen. It plays even with the sound off.',
            kit.btn('Test alarm', async () => {
              try { await api.post('/api/ring/test', {}, { readOnly: true, quiet: true }); testNote = ''; } catch (e) { testNote = e.status === 404 ? 'Restart Hourglass to test alarms: its background service is older than this window.' : e.message; render(); }
              ctx.pollState();
            }, { icon: 'volume' })),
          row('Alarm history', 'What each alarm did on this computer: rang, snoozed, dismissed (here or on another device), or broke.',
            kit.btn(history ? 'Hide' : 'Show', async () => { history = history ? null : await api.get('/api/ring/history').catch(() => []); render(); })),
          historyBlock(),
          row('Reminders', 'Tone, snooze length and alert style for reminders.', kit.btn('Reminder settings', () => ctx.go('reminders'), { icon: 'reminder' }))),
        h('section', {}, kit.section('Assistant'),
          row('Engine and keys', 'Which AI runs the assistant: the free models, your Claude subscription, or your own API key.', kit.btn('Assistant settings', () => ctx.go('assistant', { settings: true }), { icon: 'sliders' })),
          row('Usage', 'Tokens and cost per day and per model.', kit.btn('Usage', () => ctx.go('assistant', { usage: true }), { icon: 'tasks' }))),
        h('section', {}, kit.section('Use with AI'),
          h('p', { class: 'muted set-p', text: 'Tell any AI "use Hourglass to move my Tuesday lecture". Add your link as a connector (MCP server) in ChatGPT, Claude, Gemini CLI or Codex. Anyone with the link can change your schedule, so keep it to yourself.' }),
          h('div', { class: 'row wrap' },
            mcp ? h('code', { class: 'ai-link selectable', text: mcp.split('/mcp/')[0] + '/mcp/' + (mcp.split('/mcp/')[1] || '').slice(0, 8) + '…' }) : null,
            mcp ? kit.btn('Copy link', async () => { await copy(mcp); kit.toast('Link copied', { kind: 'ok' }); }, { kind: 'primary', icon: 'copy' }) : null,
            signedIn ? kit.btn(mcp ? 'New link' : 'Make my AI link', async () => {
              if (!mcp || await kit.confirm('Make a new link?', 'The old link stops working; AIs using it need the new one.', 'New link')) aiLoad(true);
            }, { icon: mcp ? 'refresh' : 'link' }) : h('small', { class: 'faint', text: 'Sign in to make a link.' }),
            mcp ? kit.btn('Delete link', async () => {
              if (await kit.confirm('Delete the AI link?', 'AIs using it lose access at once. You can make a new link any time.', 'Delete', { danger: true })) {
                try { ai = await api.del('/api/ai', { readOnly: true }); kit.toast('Link deleted'); } catch {}
                render();
              }
            }, { kind: 'danger', icon: 'trash' }) : null)),
        h('section', {}, kit.section('Account'),
          signedIn ? row(account.email || '', 'Your Jukebox account. ' + (sync.state === 'synced' ? `Synced ${U.clock(sync.last_ok || state.clock)}, shared with your phones.` : sync.state === 'offline' ? 'Offline: changes are kept here and sent when the connection is back.' : ''),
            kit.btn('Sync now', (e) => { const b = e.currentTarget; b.disabled = true; api.post('/api/sync/now', {}, { readOnly: true }).then(() => ctx.pollState()).finally(() => { b.disabled = false; }); }, { icon: 'sync' }),
            kit.btn('Sign out', async () => {
              if (await kit.confirm('Sign out?', 'This computer stops syncing until you sign in again.', 'Sign out')) api.post('/api/account/logout', {}).then(() => ctx.pollState());
            }, { kind: 'subtle' }))
            : row('Not signed in', 'Hourglass works on this computer only until you sign in.', kit.btn('Sign in', () => ctx.pollState(), { kind: 'primary' }))),
        h('section', {}, kit.section('About'),
          row(`Hourglass ${state.app.version || globalThis.HOURGLASS_VERSION || ''}`, update?.latest ? `Hourglass ${update.latest.version} is ready.` : update?.checked_at ? 'You have the newest version.' : 'Updates install by themselves when you say so.',
            update?.latest ? kit.btn('Install and restart', () => api.post('/api/update/install', {}, { readOnly: true }), { kind: 'primary', icon: 'download' })
              : kit.btn('Check for updates', async () => { update = await api.get('/api/update?check=1', { quiet: true }).catch(() => ({ checked_at: Date.now() })); render(); }, { icon: 'refresh' }))));
    }

    load();
    aiLoad(false);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return { update(w) { if (w === 'state' || w === 'data') render(); }, unmount() { clearInterval(poll); } };
  },
};
