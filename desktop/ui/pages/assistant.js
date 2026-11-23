// The assistant, in Metro's AI window (REDESIGN §6; Metro 0.5.4 ui/views/chat.js, adapted to Hourglass's
// /api/assistant). Header with engine · model · effort and usage, a transcript whose rows update in place while a
// reply streams, one terminal-style line per tool, the live status line, the composer, and the model/effort/mode
// footer. Everything AssistantPage.qml did is here: queue and steer, retry / edit / undo, plan mode, attachments,
// pasted pictures, Drive files, lightbox, copy / quote, code copy, drafts, suggestions, settings and usage.
import { h, icon, logo, swap, debounce } from '../dom.js';
import { renderMarkdown } from '../chat/md.js';
import { pickStatusWord, pastTense } from '../chat/status-words.js';
import { openStream } from '../chat/stream.js';
import { fakeChat } from '../dev/chat-fixture.js';
import { pickFiles, copy, openUrl } from '../native.js';

const SUGGESTIONS = ["What's on today?", 'Set my alarm in 1 hour', 'Wake me at 7:30 on weekdays', 'Start a 25 minute timer', 'Upcoming birthdays', 'Tidy up my latest note'];
const MODES = [
  { id: 'ask', title: 'Ask', note: 'Every change waits for approval' },
  { id: 'auto', title: 'Auto', note: 'Only risky actions wait' },
  { id: 'plan', title: 'Plan', note: 'Read only: nothing is changed' },
  { id: 'dangerous', title: 'Dangerous', note: 'Changes apply immediately' },
];
const SHOWN = 60; // a long chat draws only its newest rows; scrolling to the top shows more

export default {
  mount(root, ctx, arg) {
    const { api, state, U, kit } = ctx;
    let chat = { enabled: true, busy: false, messages: [], queue: [] };
    let pending = '';          // sent, not in the list yet
    let sending = false;
    let wasBusy = false;
    let editing = '';          // the user message being edited
    let attachments = [];      // [{ key, name, mime, id?, error?, path? }]
    let info = null;           // { file_base, key }
    let shownCount = SHOWN;
    let stick = true;          // follow the newest message
    let streamQueue = [];
    let flushTimer = 0;
    let turnStarted = 0;
    const ui = { tools: new Set(), steps: new Set(), words: new Map() };

    // ---- header ----
    const subEl = h('span', { class: 'ctx ch-sub' });
    const numsEl = h('button', { class: 'ch-nums', title: 'Usage', onclick: () => usageSheet() });
    const stateEl = h('span', { class: 'ch-state' });
    const head = ctx.head({ title: 'Assistant', mid: [stateEl], acts: [numsEl,
      kit.btn('New chat', () => newChat(), { icon: 'plus', title: 'New chat (Ctrl+N)' }),
      kit.btn('', (e) => headMenu(e.currentTarget), { kind: 'subtle', icon: 'more', title: 'More' })] });
    head.insertBefore(subEl, head.querySelector('.mid'));

    // ---- transcript ----
    const msgs = h('div', { class: 'msgs selectable' });
    const toBottom = h('button', { class: 'to-bottom', hidden: true, onclick: () => { stick = true; scrollEnd(true); } }, icon('arrow-down'), 'New messages');
    const quotaEl = h('div', { class: 'quota', hidden: true });
    const statusEl = h('div', { class: 'statusline', hidden: true });

    // ---- composer ----
    const ta = h('textarea', { rows: '1', placeholder: 'Ask Hourglass…', spellcheck: 'true' });
    const chipsEl = h('div', { class: 'att-chips', hidden: true });
    const editBar = h('div', { class: 'edit-bar', hidden: true }, h('span', { class: 'grow ellipsis', text: 'Editing a message: sending replaces it and everything after it' }), kit.btn('Cancel', () => cancelEdit(), { kind: 'subtle', compact: true }));
    const plusBtn = kit.btn('', (e) => plusMenu(e.currentTarget), { kind: 'subtle', icon: 'plus', title: 'Attach files, Drive files or a pasted picture', cls: 'plusbtn' });
    const steerBtn = kit.btn('Steer', () => send(true), { kind: 'subtle', compact: true, title: 'Send into the running answer (Ctrl+Enter)', cls: 'steerbtn' });
    const sendBtn = h('button', { class: 'btn primary sendbtn', type: 'button', title: 'Send (Enter)', onclick: () => (sendBtn.classList.contains('stopping') && !hasDraft() ? stop() : send(false)) }, icon('arrow-right'));
    const composer = h('div', { class: 'composer' }, plusBtn, h('div', { class: 'col grow ta-col' }, chipsEl, ta), steerBtn, sendBtn);
    const engineLine = h('span', { class: 'ellipsis composer-agent' });
    const modelChip = h('button', { class: 'quiet-chip', onclick: (e) => modelMenu(e.currentTarget) });
    const modeChip = h('button', { class: 'quiet-chip mode-chip', onclick: (e) => modeMenu(e.currentTarget) });
    const modeNote = h('span', { class: 'mode-note' });
    const foot = h('div', { class: 'composer-foot' }, engineLine, modeNote, h('span', { class: 'grow' }), modelChip, h('span', { class: 'mode-slot' }, modeChip));
    const wrap = h('div', { class: 'composer-wrap' }, editBar, statusEl, composer, foot);

    const chatEl = h('div', { class: 'chat' }, h('div', { class: 'msgs-wrap' }, msgs, toBottom), quotaEl, wrap);
    const railEl = h('aside', { class: 'chat-rail' });
    root.append(head, h('div', { class: 'page flush chat-page' }, h('div', { class: 'chat-split' }, chatEl, railEl)));

    // ---- helpers ----
    const busy = () => sending || !!chat.busy || pending !== '' || (chat.queue || []).length > 0;
    const canSteer = () => chat.engine === 'anthropic' || chat.engine === 'openai';
    const uploading = () => attachments.some((a) => !a.id && !a.error);
    const hasDraft = () => ta.value.trim() !== '' || attachments.some((a) => a.id);
    const tokens = (n) => { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n); };
    const elapsed = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
    const fileUrl = (f) => (info ? info.file_base + f.id + '?k=' + info.key : '');
    const messages = () => {
      const list = (chat.messages || []).slice();
      if (pending !== '' && !list.some((m) => m.role === 'user' && m.text === pending)) list.push({ id: 'pending', role: 'user', text: pending, tools: [], files: attachments.filter((a) => a.id) });
      return list;
    };
    const lastAssistant = () => { const l = chat.messages || []; for (let i = l.length - 1; i >= 0; i--) if (l[i].role === 'assistant') return String(l[i].id); return ''; };
    const changedFile = (m) => (m.cards || []).some((c) => c.kind === 'file' && ['changed', 'created', 'deleted'].includes(c.state));
    const undoTarget = () => { const l = chat.messages || []; for (let i = l.length - 1; i >= 0; i--) if (l[i].role === 'assistant' && changedFile(l[i])) return String(l[i].id); return ''; };
    function shortModel() {
      const m = String(chat.model || '');
      return m.replace(/^opencode\//, '').replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^./, (c) => c.toUpperCase());
    }
    // "Claude API · Haiku 5.5", "Free · big-pickle"; the effort is always shown, never just the model.
    function engineName() {
      if (chat.engine === 'anthropic') return 'Claude API';
      if (chat.engine === 'claude') return 'Claude plan';
      if (chat.engine === 'openai') return chat.engine_name || 'API';
      return 'Free';
    }
    function lastUsage() {
      const l = chat.messages || [];
      for (let i = l.length - 1; i >= 0; i--) { const u = l[i].usage; if (u && u.context_percent != null) return u; }
      return null;
    }

    // ---- loading and the stream ----
    async function load() {
      let d;
      if (state.dev.has('fakechat')) { chat = fakeChat(); render(); return; }
      try { d = await api.get('/api/assistant', { quiet: true }); } catch (e) {
        d = e.status === 404 ? { enabled: false, busy: false, messages: [], reason: 'Restart Hourglass to use the assistant: its background service is older than this window.' } : null;
      }
      if (!d) return;
      chat = d;
      if (pending !== '' && (d.messages || []).some((m) => m.role === 'user' && m.text === pending)) pending = '';
      // Finished: pull what the assistant changed, so every page shows it.
      if (wasBusy && !d.busy && pending === '') { api.post('/api/sync/now', {}, { readOnly: true, quiet: true }).catch(() => {}); ctx.refresh(); }
      wasBusy = d.busy || pending !== '';
      restoreDraft();
      render();
    }
    const stream = openStream({
      onEvent: (name, d) => { streamQueue.push([name, d]); if (!flushTimer) flushTimer = setTimeout(flush, 120); },
      onOpen: () => load(),
    });
    // Events arrive faster than they're worth drawing: they're applied together, a few times a second.
    function flush() {
      flushTimer = 0;
      const events = streamQueue;
      streamQueue = [];
      let reload = false;
      chat = { ...chat, messages: (chat.messages || []).slice() };
      const msg = (id) => { const i = chat.messages.findIndex((m) => m.id === id); if (i < 0) return null; chat.messages[i] = { ...chat.messages[i] }; return chat.messages[i]; };
      for (const [name, d] of events) {
        if (name === 'ready') Object.assign(chat, { enabled: d.enabled, engine: d.engine, model: d.model, effort: d.effort, state: d.state, busy: d.busy, queued: d.queued });
        else if (name === 'state') { Object.assign(chat, { state: d.state, busy: d.busy, queued: d.queued }); reload = true; }
        else if (name === 'message_start') {
          chat.busy = true; chat.state = 'busy';
          turnStarted = d.at || Date.now();
          if (d.user_message_id && !chat.messages.some((m) => m.id === d.user_message_id)) {
            // The question first, so the answer never lands above it: the box's text, or the next in the queue.
            const q = (chat.queue || [])[0];
            const text = pending !== '' ? pending : q ? q.text : null;
            if (text !== null) {
              chat.messages.push({ id: d.user_message_id, role: 'user', time: d.at || Date.now(), text, tools: [], files: [], cards: [], steps: [] });
              if (q && pending === '') chat.queue = chat.queue.slice(1);
            }
            reload = true;
          }
          if (!chat.messages.some((m) => m.id === d.message_id)) chat.messages.push({ id: d.message_id, role: 'assistant', time: d.at || Date.now(), text: '', tools: [], files: [], cards: [], pending_actions: [], steps: [], usage: null, error: null, model: d.model || null, quick: !!d.quick });
        } else if (name === 'text') {
          const m = msg(d.message_id);
          if (!m) { reload = true; continue; }
          m.text = d.text;
        } else if (name === 'tool_start' || name === 'tool_update' || name === 'tool_end') {
          const m = msg(d.message_id);
          if (!m) { reload = true; continue; }
          const tools = (m.tools || []).slice();
          const at = tools.findIndex((t) => t.call_id === d.id);
          const next = { call_id: d.id };
          for (const k of ['tool', 'label', 'status', 'input', 'output', 'duration_ms', 'diff']) if (d[k] !== undefined) next[k] = d[k];
          if (at >= 0) tools[at] = { ...tools[at], ...next }; else tools.push({ tool: '', label: '', status: 'running', input: '', output: '', ...next });
          m.tools = tools;
        } else if (name === 'usage') { const m = msg(d.message_id); if (m) m.usage = { ...(m.usage || {}), ...d }; }
        else if (name === 'steer') reload = true;
        else if (name === 'quota') chat.quota = d.state === 'quota' ? d : null;
        else if (name === 'message_end') {
          const m = msg(d.message_id);
          if (m) {
            if (d.text != null) m.text = d.text;
            m.error = d.error || null; m.error_kind = d.error_kind || null; m.error_resets_at = d.error_resets_at || null;
            if (d.model) m.model = d.model;
            if (d.usage) m.usage = d.usage;
          }
          reload = true;
        }
      }
      render();
      if (reload) load();
    }

    // ---- sending ----
    async function send(steer) {
      const files = attachments.filter((a) => a.id);
      const kept = attachments;
      const raw = ta.value;
      // With only files, the server says what the message is.
      const t = raw.trim() || (files.length ? `(see the attached file${files.length > 1 ? 's)' : ')'}` : '');
      if (!t || sending || uploading() || !chat.enabled) return;
      if (editing) return sendEdit(t, files, kept, raw);
      const running = !!chat.busy;
      if (!running) pending = t;
      sending = true;
      wasBusy = true;
      ta.value = '';
      attachments = [];
      autosize();
      saveDraft();
      stick = true;
      render();
      const body = { text: t, files: files.map((a) => a.id) };
      if (steer && running && canSteer()) body.steer = true;
      try {
        const d = await api.post('/api/assistant/message', body, { readOnly: true });
        if (d?.queued) chat = { ...chat, queue: [...(chat.queue || []), { id: d.id, at: Date.now(), text: t, files: files.length }] };
      } catch {
        if (!running) pending = '';
        ta.value = raw; attachments = kept; autosize();
      }
      sending = false;
      load();
    }
    async function sendEdit(t, files, kept, raw) {
      const id = editing;
      sending = true; wasBusy = true;
      ta.value = ''; attachments = []; editing = '';
      autosize();
      render();
      const body = { message_id: id, text: t };
      if (files.length) body.files = files.map((a) => a.id);
      try { await api.post('/api/assistant/edit', body, { readOnly: true }); } catch { ta.value = raw; attachments = kept; editing = id; autosize(); }
      sending = false;
      load();
    }
    function beginEdit(m) {
      editing = String(m.id);
      ta.value = m.text || '';
      autosize();
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      render();
    }
    function cancelEdit() { editing = ''; ta.value = ''; autosize(); render(); }
    const cancelQueued = (id) => { chat = { ...chat, queue: (chat.queue || []).filter((q) => q.id !== id) }; render(); api.del('/api/assistant/queue/' + id, { readOnly: true }).finally(load); };
    async function steerQueued(q) { cancelQueued(q.id); await api.post('/api/assistant/message', { text: q.text, steer: true }, { readOnly: true }).catch(() => {}); load(); }
    const retry = (id) => { wasBusy = true; api.post('/api/assistant/retry', { message_id: id }, { readOnly: true }).then(load).catch(() => {}); };
    const undo = () => api.post('/api/assistant/undo', {}, { readOnly: true }).then((d) => { kit.toast(d?.action === 'deleted' ? `Removed ${d.name}` : d?.name ? `Restored ${d.name}` : 'Undone', { kind: 'ok' }); load(); api.post('/api/sync/now', {}, { readOnly: true, quiet: true }).catch(() => {}); }).catch(() => {});
    const stop = () => api.post('/api/assistant/stop', {}, { readOnly: true }).then(load).catch(() => {});
    async function newChat() {
      if (!(chat.messages || []).length && !pending) return;
      await api.post('/api/assistant/new', {}, { readOnly: true }).catch(() => {});
      pending = ''; editing = ''; ui.tools.clear(); ui.steps.clear(); shownCount = SHOWN;
      rows.clear();
      load();
    }
    const setMode = (m) => api.post('/api/assistant/mode', { mode: m }, { readOnly: true }).then((d) => { chat = { ...chat, mode: d?.mode || m }; render(); load(); }).catch(() => {});
    const action = (id, verb) => api.post(`/api/assistant/actions/${id}/${verb}`, {}).then(load).catch(() => {});

    // ---- attachments: uploaded to the Drive's "Assistant" folder now, sent with the message as their ids ----
    async function attach(paths) {
      if (!paths.length) return;
      const added = paths.map((p) => {
        const name = p.split(/[\\/]/).pop();
        const ext = name.split('.').pop().toLowerCase();
        return { key: p + Math.random(), path: p, name, mime: ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? 'image/' + (ext === 'jpg' ? 'jpeg' : ext) : '' };
      });
      attachments = [...attachments, ...added];
      paintChips();
      const folder = await api.get('/api/assistant/folder', { quiet: true }).catch((e) => ({ error: e.message }));
      await Promise.all(added.map(async (a) => {
        if (!folder?.folder_id) return setAttachment(a.key, { error: folder?.error || 'Could not upload' });
        try {
          const row = await api.post('/api/files/upload', { path: a.path, folder: folder.folder_id }, { readOnly: true, quiet: true });
          if (row?.files) { // a folder: one attachment per file in it
            const i = attachments.findIndex((x) => x.key === a.key);
            if (i >= 0) attachments = [...attachments.slice(0, i), ...row.files.map((r) => ({ key: r.id, id: r.id, mime: r.mime, name: r.name })), ...attachments.slice(i + 1)];
            paintChips();
          } else setAttachment(a.key, { id: row.id, mime: row.mime, name: row.name });
        } catch (e) { setAttachment(a.key, { error: e.message }); }
      }));
      saveDraft();
    }
    function setAttachment(key, patch) { attachments = attachments.map((a) => (a.key === key ? { ...a, ...patch } : a)); paintChips(); }
    // The picture on the clipboard: the service reads it (the window can only paste text).
    async function pasteImage() {
      const d = await api.post('/api/clipboard/image', {}, { readOnly: true, quiet: true }).catch(() => null);
      if (d?.path) attach([d.path]); else kit.toast('There is no picture on the clipboard.');
    }
    async function drivePicker() {
      let folder = '', courseId = '';
      const listEl = h('div', { class: 'stack8 drive-pick' });
      const s = kit.sheet({ title: 'Attach from Drive', subtitle: 'Pick files the assistant should read.', body: [listEl], footer: [h('span', { class: 'grow' }), kit.btn('Done', () => s.close(), { kind: 'primary' })] });
      async function show() {
        const args = courseId ? { course_id: courseId } : folder ? { folder_id: folder } : {};
        const d = await api.action('list_drive', args, { quiet: true }).catch(() => null);
        if (!d) return;
        const row = (ic, name, sub, fn, on) => h('button', { class: `pick-row ${on ? 'on' : ''}`, onclick: fn }, icon(ic), h('span', { class: 'grow ellipsis', text: name }), sub ? h('small', { class: 'faint', text: sub }) : null, on ? icon('check', 'ok-ink') : null);
        swap(listEl,
          folder || courseId ? row('back', 'Back to the top', '', () => { folder = ''; courseId = ''; show(); }) : null,
          (d.courses || []).map((c) => row('courses', c.name, 'course', () => { courseId = c.id; folder = ''; show(); })),
          d.folders.map((f) => row('folder', f.name, 'folder', () => { folder = f.id; show(); })),
          d.files.map((f) => row('file', f.name, U.bytes(f.size), () => {
            if (!attachments.some((a) => a.id === f.id)) attachments = [...attachments, { key: f.id, id: f.id, name: f.name, mime: f.mime || '' }];
            else attachments = attachments.filter((a) => a.id !== f.id);
            paintChips(); saveDraft(); show();
          }, attachments.some((a) => a.id === f.id))),
          !d.files.length && !d.folders.length && !(d.courses || []).length ? h('div', { class: 'quiet', text: 'Nothing here.' }) : null);
      }
      show();
    }
    function paintChips() {
      chipsEl.hidden = !attachments.length;
      swap(chipsEl, attachments.map((a) => h('span', { class: `att-chip ${a.error ? 'bad' : !a.id ? 'loading' : ''}`, 'data-tip': a.error || a.name },
        /^image\//.test(a.mime || '') && a.id && info ? h('img', { src: fileUrl(a) }) : icon(/^image\//.test(a.mime || '') ? 'image' : 'file'),
        h('span', { class: 'ellipsis', text: a.error ? `${a.name} · ${a.error}` : a.id ? a.name : `${a.name} · uploading…` }),
        h('button', { class: 'x', title: 'Remove', onclick: () => { attachments = attachments.filter((x) => x.key !== a.key); paintChips(); saveDraft(); } }, icon('close')))));
      paintSend();
    }

    // ---- drafts: one per chat (told apart by its first message), kept across page switches and restarts ----
    const draftKey = () => { const m = chat.messages || []; return m.length ? String(m[0].id) : 'new'; };
    let loadedDraft = '';
    const readDrafts = () => { try { return JSON.parse(localStorage.getItem('hg.drafts') || '{}'); } catch { return {}; } };
    function saveDraft() {
      if (!loadedDraft) return;
      const all = readDrafts();
      const files = attachments.filter((a) => a.id).map(({ key, id, name, mime }) => ({ key, id, name, mime: mime || '' }));
      if (!ta.value.trim() && !files.length) delete all[loadedDraft]; else all[loadedDraft] = { text: ta.value, files };
      localStorage.setItem('hg.drafts', JSON.stringify(all));
    }
    function restoreDraft() {
      const k = draftKey();
      if (k === loadedDraft) return;
      if (loadedDraft) saveDraft();
      loadedDraft = k;
      const d = readDrafts()[k];
      if (!editing && !sending) { ta.value = d ? d.text : ''; attachments = d ? d.files : []; autosize(); paintChips(); }
    }
    const saveDraftSoon = debounce(saveDraft, 500);

    // ---- the transcript: one element per message, rebuilt only when that message changed ----
    const rows = new Map(); // id -> { el, sig }
    function wordFor(id) { if (!ui.words.has(id)) ui.words.set(id, pickStatusWord()); return ui.words.get(id); }

    function toolLine(t, mid) {
      const key = mid + ':' + t.call_id;
      const st = t.status === 'running' ? 'run' : t.status === 'error' ? 'err' : 'ok';
      const el = h('div', { class: `tool ${st}` });
      const summary = toolSummary(t);
      el.append(h('div', { class: 'tline', onclick: () => { ui.tools.has(key) ? ui.tools.delete(key) : ui.tools.add(key); redrawMessage(mid); } },
        h('span', { class: `tdot ${st}`, text: st === 'run' ? '●' : st === 'ok' ? '✓' : '✕' }),
        h('span', { class: 'tname', text: t.label || t.tool || 'Tool' }),
        summary ? h('span', { class: 'tsum', text: summary }) : null,
        t.duration_ms != null && st !== 'run' ? h('span', { class: 'tms', text: t.duration_ms >= 1000 ? (t.duration_ms / 1000).toFixed(1) + 's' : t.duration_ms + 'ms' }) : null));
      if (t.diff && (t.diff.added || t.diff.removed)) el.append(h('div', { class: 'tresult', text: `⎿ +${t.diff.added || 0} −${t.diff.removed || 0} lines` }));
      else if (st === 'err' && t.output) el.append(h('div', { class: 'tresult err', text: '⎿ ' + oneLine(t.output) }));
      if (ui.tools.has(key)) {
        el.append(h('div', { class: 'tbody' },
          t.input ? [h('b', { text: 'Input' }), h('pre', { text: pretty(t.input) })] : null,
          st === 'run' ? [h('b', { text: '…' }), h('pre', { text: 'Running…' })] : t.output ? [h('b', { text: st === 'err' ? 'Error' : 'Output' }), h('pre', { text: pretty(t.output) })] : null,
          t.diff?.lines?.length ? [h('b', { text: 'Changes' }), h('div', { class: 'diff' }, t.diff.lines.map((l) => h('div', { class: `dl ${l.op}`, text: l.op === 'skip' ? `⋯ ${l.count} lines the same` : (l.op === 'add' ? '+ ' : l.op === 'del' ? '− ' : '  ') + l.text })))] : null));
      }
      return el;
    }
    // The tool's own words, short: a time, a title, a path. Never the user's message back.
    function toolSummary(t) {
      let a;
      try { a = JSON.parse(t.input || '{}'); } catch { return ''; }
      const pick = a.title || a.label || a.name || a.query || a.time || a.course || a.date || a.zone || '';
      const s = String(pick).replace(/\s+/g, ' ').trim();
      return s.split(' ').length > 8 ? '' : s.length > 60 ? s.slice(0, 57) + '…' : s;
    }
    const oneLine = (s) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > 120 ? t.slice(0, 117) + '…' : t; };
    const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return String(s); } };

    function card(c) {
      const k = c.kind;
      if (k === 'file') {
        const st = { read: 'Read', created: 'Created', deleted: 'Deleted', undone: 'Undone' }[c.state] || 'Changed';
        return h('button', { class: 'card hover rcard stripe', style: { '--c': 'var(--teal)' }, onclick: () => ctx.go('drive') }, icon('file', 'rc-ic'), h('div', { class: 'col grow' }, h('b', { class: 'ellipsis', text: c.label || c.name || 'Drive file' }), h('small', { class: 'muted', text: `${st} · ${U.bytes(c.size || 0)} · +${c.diff?.added || 0} / −${c.diff?.removed || 0} lines` })), h('span', { class: 'rc-open', text: 'Open' }));
      }
      if (k === 'day') {
        return h('div', { class: 'card rcard day-card' }, h('b', { text: c.label }), h('div', { class: 'stack8' }, (c.items || []).map((it) => h('div', { class: 'row' }, h('i', { class: 'swatch', style: { '--c': it.color || 'var(--accent)' } }), h('span', { class: 'muted tnum', text: `${it.start}–${it.end}` }), h('span', { class: 'ellipsis', text: it.title }))), !(c.items || []).length ? h('small', { class: 'muted', text: 'Nothing on.' }) : null));
      }
      const go = { alarm: 'alarms', timer: 'timers', event: 'schedule', note: 'notes', reminder: 'reminders', setting: 'settings' }[k];
      const big = k === 'alarm' || k === 'reminder' ? c.time : k === 'timer' ? (c.ends_at && c.state === 'running' ? U.countdown((c.ends_at - state.clock) / 1000) : U.countdown(c.duration_s || 0)) : k === 'event' ? (c.days_until != null ? (c.days_until === 0 ? 'Today' : `${c.days_until}d`) : c.time) : k === 'setting' ? c.value : '';
      const sub = [c.when, c.repeats, k === 'note' ? c.course : '', c.state && !['set', 'running', 'found', 'added'].includes(c.state) ? c.state : ''].filter(Boolean).join(' · ');
      const ic = { alarm: 'bell', timer: 'timer', event: c.birthday ? 'star' : 'calendar', note: 'note', reminder: 'reminder', setting: 'gear' }[k] || 'info';
      return h('button', { class: `card hover rcard stripe ${c.state === 'removed' ? 'removed' : ''}`, style: { '--c': c.overdue ? 'var(--orange)' : 'var(--accent)' }, onclick: () => go && ctx.go(go), 'data-timer-end': k === 'timer' && c.state === 'running' ? String(c.ends_at) : null },
        icon(ic, 'rc-ic'), big ? h('span', { class: 'rc-big tnum', text: big }) : null,
        h('div', { class: 'col grow' }, h('b', { class: 'ellipsis', text: c.label || U.kindLabel(k) }), sub ? h('small', { class: 'muted ellipsis', text: sub }) : null),
        go ? h('span', { class: 'rc-open', text: 'Open' }) : null);
    }

    function images(m) {
      const pics = (m.files || []).filter((f) => /^image\//.test(f.mime || ''));
      const other = (m.files || []).filter((f) => !/^image\//.test(f.mime || ''));
      if (!pics.length && !other.length) return null;
      return h('div', { class: 'bimgs' },
        info ? pics.map((f) => h('img', { src: fileUrl(f), alt: f.name, onclick: (e) => { e.stopPropagation(); lightbox(f.id); } })) : null,
        other.map((f) => h('span', { class: 'img-chip' }, icon('file'), f.name)));
    }

    function messageEl(m, i, list) {
      const isLast = i === list.length - 1;
      if (m.role === 'user') {
        return h('div', { class: `msg user ${m.id === 'pending' ? 'sending' : ''}`, 'data-id': m.id, oncontextmenu: (e) => msgMenu(e, m) },
          h('div', { class: 'bubble' }, m.text, images(m)),
          m.steer ? h('span', { class: 'qtag steering', text: 'Steered into the running answer' }) : null,
          m.id !== 'pending' ? h('div', { class: 'msg-acts' },
            h('button', { onclick: () => { copy(m.text || ''); kit.toast('Copied', { kind: 'ok' }); } }, icon('copy'), 'Copy'),
            !busy() ? h('button', { onclick: () => beginEdit(m) }, icon('edit'), 'Edit') : null) : null);
      }
      const running = chat.busy && isLast;
      const steps = (m.steps || []).filter((s) => /^Thinking:/.test(s.text || ''));
      const allSteps = steps.length ? steps : (m.steps || []);
      const stepsDur = allSteps.length > 1 ? allSteps[allSteps.length - 1].at - allSteps[0].at : 0;
      const el = h('div', { class: 'msg ai', 'data-id': m.id, oncontextmenu: (e) => msgMenu(e, m) });
      if (allSteps.length && (steps.length || ui.steps.has(m.id))) {
        const open = ui.steps.has(m.id);
        el.append(h('div', { class: 'think' },
          h('button', { class: 'think-head', onclick: () => { open ? ui.steps.delete(m.id) : ui.steps.add(m.id); redrawMessage(m.id); } },
            h('span', { text: open ? '▾' : '▸' }), running && !m.text ? `${wordFor(m.id)}…` : `${pastTense(wordFor(m.id))}${stepsDur >= 1000 ? ' for ' + elapsed(stepsDur) : ''}`),
          open ? h('div', { class: 'think-body' }, allSteps.map((s) => h('div', { text: s.text.replace(/^Thinking:\s*/, '') }))) : null));
      }
      for (const t of m.tools || []) el.append(toolLine(t, m.id));
      if (m.text) el.append(h('div', { class: 'txt', html: renderMarkdown(m.text) }));
      if ((m.cards || []).length) el.append(h('div', { class: 'cards' }, m.cards.map(card)));
      for (const a of m.pending_actions || []) {
        el.append(h('div', { class: `card ask-card ${a.status === 'pending' ? 'pending' : ''}` },
          h('div', { class: 'row' }, icon(a.status === 'pending' ? 'warning' : a.status === 'applied' ? 'check' : 'close', 'muted'), h('span', { class: 'grow', text: a.summary || 'Action' })),
          a.status === 'pending' ? h('div', { class: 'row' }, kit.btn('Apply', () => action(a.id, 'apply'), { kind: 'primary', compact: true }), kit.btn('Skip', () => action(a.id, 'skip'), { kind: 'subtle', compact: true })) : h('small', { class: 'faint', text: String(a.status || '').toUpperCase() })));
      }
      if (m.error) {
        el.append(h('div', { class: 'msgerr' }, h('span', { text: m.error }), m.error_resets_at ? h('small', { text: ` · resets ${U.clock(m.error_resets_at)}` }) : null,
          String(m.id) === lastAssistant() && !busy() ? kit.btn('Retry', () => retry(m.id), { compact: true, icon: 'refresh' }) : null));
      }
      if (!running && (m.text || (m.tools || []).length)) {
        const acts = [h('button', { onclick: () => { copy(plainText(m.text || '')); kit.toast('Copied', { kind: 'ok' }); } }, icon('copy'), 'Copy'),
          m.text ? h('button', { onclick: () => quote(m.text) }, icon('quote'), 'Quote') : null];
        if (String(m.id) === lastAssistant() && !busy()) acts.push(h('button', { onclick: () => retry(m.id) }, icon('refresh'), 'Retry'));
        if (String(m.id) === undoTarget() && !busy()) acts.push(h('button', { onclick: undo }, icon('undo'), 'Undo'));
        const u = m.usage;
        el.append(h('div', { class: 'msg-acts ai-acts' }, acts, u && (u.input_tokens != null || u.output_tokens != null) ? h('span', { class: 'usage-cap', text: usageCaption(u, m.model) }) : null));
      }
      return el;
    }
    function usageCaption(u, model) {
      const parts = [];
      if (model) parts.push(String(model).replace(/^opencode\//, ''));
      parts.push(`${tokens(u.input_tokens)} in · ${tokens(u.output_tokens)} out`);
      if (u.cost != null) parts.push('$' + Number(u.cost).toFixed(4));
      return parts.join('  ·  ');
    }
    function queueEl(q) {
      return h('div', { class: 'msg user queued', 'data-id': 'q:' + q.id },
        h('div', { class: 'bubble' }, q.text, q.files ? h('small', { class: 'faint', text: `  · ${U.plural(q.files, 'file')}` }) : null),
        h('span', { class: 'qtag' }, 'Queued · after this reply',
          canSteer() ? h('button', { class: 'qtag-now', onclick: () => steerQueued(q) }, 'Send now') : null,
          h('button', { class: 'qtag-x', title: 'Cancel', onclick: () => cancelQueued(q.id) }, icon('close'))));
    }

    function redrawMessage(id) {
      const r = rows.get(id);
      const list = messages();
      const i = list.findIndex((m) => String(m.id) === String(id));
      if (!r || i < 0) return render();
      const el = messageEl(list[i], i, list);
      r.el.replaceWith(el);
      r.el = el;
      r.sig = sigOf(list[i], i, list);
    }
    const sigOf = (m, i, list) => JSON.stringify([m, i === list.length - 1, chat.busy, busy(), lastAssistant(), undoTarget(), !!info, ui.words.get(m.id)]);

    let firstPaint = true;
    function renderTranscript() {
      const list = messages();
      if (!list.length && !(chat.queue || []).length) {
        rows.clear();
        swap(msgs, emptyState());
        return;
      }
      msgs.querySelector('.empty-chat')?.remove();
      const shown = list.slice(-shownCount);
      const keep = new Set(shown.map((m) => String(m.id)));
      for (const [id, r] of rows) if (!keep.has(id)) { r.el.remove(); rows.delete(id); }
      // The pending row becomes the real one when it arrives.
      let prev = null;
      const more = list.length > shown.length ? (msgs.querySelector('.msgs-more') || h('button', { class: 'msgs-more', onclick: () => { shownCount += SHOWN; const before = msgs.scrollHeight; render(); msgs.scrollTop += msgs.scrollHeight - before; } }, 'Show earlier messages')) : null;
      if (more) { if (msgs.firstChild !== more) msgs.prepend(more); prev = more; } else msgs.querySelector('.msgs-more')?.remove();
      shown.forEach((m, j) => {
        const i = list.length - shown.length + j;
        const id = String(m.id);
        const sig = sigOf(m, i, list);
        let r = rows.get(id);
        if (!r) {
          r = { el: messageEl(m, i, list), sig };
          if (!firstPaint) r.el.classList.add('row-enter');
          rows.set(id, r);
        } else if (r.sig !== sig) {
          const el = messageEl(m, i, list);
          r.el.replaceWith(el);
          r.el = el;
          r.sig = sig;
        }
        const want = prev ? prev.nextSibling : msgs.firstChild;
        if (r.el !== want) msgs.insertBefore(r.el, want);
        prev = r.el;
      });
      // Queued messages sit after the transcript.
      for (const el of [...msgs.querySelectorAll('.msg.queued')]) el.remove();
      for (const q of chat.queue || []) msgs.append(queueEl(q));
      firstPaint = false;
    }
    function emptyState() {
      return h('div', { class: 'empty-chat' }, logo(5, { alive: true }),
        h('h2', { text: chat.enabled ? 'Ask Hourglass to do it for you' : (chat.reason || 'The assistant is not available.') }),
        chat.enabled ? h('p', { class: 'muted', text: 'It can read and change your notes, schedule, alarms, timers and Drive.' }) : null,
        chat.enabled ? h('div', { class: 'suggest stagger' }, SUGGESTIONS.map((s) => h('button', { class: 'suggestion', onclick: () => { ta.value = s; send(false); } }, s))) : null,
        !chat.enabled ? kit.btn('Assistant settings', () => settingsSheet(), { icon: 'sliders' }) : null);
    }

    // ---- the live status line ----
    function paintStatus() {
      const list = chat.messages || [];
      const cur = list.length ? list[list.length - 1] : null;
      const on = busy() && chat.enabled;
      statusEl.hidden = !on;
      chatEl.toggleAttribute('data-working', !!chat.busy);
      if (!on) return;
      const tool = [...(cur?.tools || [])].reverse().find((t) => t.status === 'running');
      const word = tool ? (tool.label || tool.tool || 'Working') + '…' : cur?.role === 'assistant' && cur.text ? 'Writing…' : `${wordFor(cur?.id || 'next')}…`;
      const started = cur?.role === 'assistant' ? cur.time : turnStarted || Date.now();
      const u = cur?.role === 'assistant' ? cur.usage : null;
      const meta = [chat.busy ? elapsed(Date.now() - started) : (chat.queue || []).length ? 'waiting' : 'sending', u ? `${tokens((u.input_tokens || 0) + (u.output_tokens || 0))} tokens` : ''].filter(Boolean).join(' · ');
      swap(statusEl, h('span', { class: 'spark' }), h('span', { class: 'sl-verb', text: word }), h('span', { class: 'sl-meta', text: meta }));
    }

    // ---- header, footer, composer state ----
    function paintChrome() {
      subEl.textContent = [engineName(), shortModel() || 'auto', chat.effort].filter(Boolean).join(' · ');
      const u = lastUsage();
      numsEl.hidden = !u;
      if (u) {
        const pct = Number(u.context_percent);
        swap(numsEl, h('span', { text: `${tokens((u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0))} tokens` }),
          h('span', { class: 'ctx-bar' }, h('i', { class: pct > 80 ? 'red' : pct > 60 ? 'amber' : '', style: { width: `${Math.min(100, pct)}%` } })),
          h('span', { text: `${pct.toFixed(pct < 10 ? 1 : 0).replace(/\.0$/, '')}% context` }));
      }
      const st = !chat.enabled ? 'off' : chat.busy ? 'working' : (chat.queue || []).length ? 'queued' : chat.quota ? 'limit' : 'idle';
      stateEl.textContent = st;
      stateEl.className = `ch-state s-${st}`;
      engineLine.textContent = chat.engine === 'free' || !chat.engine ? 'Free models' : chat.engine === 'claude' ? 'Your Claude plan' : 'Your API key';
      modelChip.replaceChildren(h('span', { text: `${shortModel() || 'Auto'} · ${chat.effort ? chat.effort.charAt(0).toUpperCase() + chat.effort.slice(1) : 'Default'}` }), h('span', { class: 'chip-caret', text: '⌄' }));
      const mode = chat.mode || 'auto';
      modeChip.replaceChildren(h('span', { text: MODES.find((m) => m.id === mode)?.title || mode }), h('span', { class: 'chip-caret', text: '⌄' }));
      modeChip.className = `quiet-chip mode-chip m-${mode}`;
      modeNote.textContent = mode === 'dangerous' ? 'Changes and deletions apply without asking' : mode === 'plan' ? 'It reads and plans, nothing is changed' : '';
      modeNote.className = `mode-note m-${mode}`;
      const q = chat.quota;
      quotaEl.hidden = !q;
      if (q) quotaEl.textContent = 'Limit reached' + (q.resets_at ? `, continues at ${U.clock(q.resets_at)}` : '') + (q.message ? ' · ' + q.message : '');
      editBar.hidden = !editing;
      ta.placeholder = !chat.enabled ? 'The assistant is off' : editing ? 'Edit your message…' : chat.busy ? (canSteer() ? 'Queue a message, or Ctrl+Enter to steer…' : 'Queue a message for after this reply…') : 'Ask Hourglass…';
      ta.disabled = !chat.enabled;
      paintSend();
    }
    function paintSend() {
      const working = !!chat.busy;
      const stopping = working && !hasDraft();
      sendBtn.classList.toggle('stopping', stopping);
      sendBtn.replaceChildren(icon(stopping ? 'stop' : 'arrow-right'));
      sendBtn.title = stopping ? 'Stop' : editing ? 'Send the edit' : 'Send (Enter)';
      sendBtn.disabled = !chat.enabled || (!stopping && (!hasDraft() || uploading() || sending));
      steerBtn.hidden = !(working && canSteer() && hasDraft());
    }

    // ---- scrolling: stick to the bottom while at the bottom ----
    const nearBottom = () => msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
    function scrollEnd(smooth = false) { msgs.scrollTo({ top: msgs.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); toBottom.hidden = true; }
    msgs.addEventListener('scroll', () => {
      stick = nearBottom();
      if (stick) toBottom.hidden = true;
      if (msgs.scrollTop < 40 && messages().length > shownCount) msgs.querySelector('.msgs-more')?.click();
    });

    // ---- the rail: what this chat changed (Undo where it can be undone), what it can see, things to try ----
    const READS = /^(get|list|search|find|read|note_versions|world_clock|reminder_settings|whats_now|drive_info|usage)/;
    let driveInfo = null;
    function paintRail() {
      const changes = [];
      for (const m of chat.messages || []) {
        if (m.role !== 'assistant') continue;
        for (const t of m.tools || []) if (!READS.test(t.tool || '') && t.status !== 'error') changes.push({ m, t });
      }
      const n = state.now;
      const later = (n?.today || []).filter((o) => o.end_ms > state.clock && o !== n?.active && o.event_id !== n?.active?.event_id).length;
      const notes = state.notes || [];
      const see = [
        ['now', 'Today', [n?.active?.state === 'live' ? `${n.active.title} live` : '', later ? `${U.plural(later, 'more session')}` : ''].filter(Boolean).join(', ') || 'Nothing else on'],
        ['bell', 'Alarms', (n?.alarms || []).length ? `next ${U.clock(n.alarms[0].next_at)}` : 'none set'],
        ['notes', 'Notes', `${U.plural(notes.length, 'note')} in ${U.plural(state.courses.length, 'course')}`],
        driveInfo?.used != null ? ['drive', 'Drive', `${U.bytes(driveInfo.used)}${driveInfo.files != null ? ` in ${U.plural(driveInfo.files, 'file')}` : ''}`] : null,
      ].filter(Boolean);
      swap(railEl,
        changes.length ? h('div', { class: 'card raised rail-card' }, kit.section('Changes in this chat', String(changes.length)),
          h('div', { class: 'changes' }, changes.slice(-6).reverse().map(({ m, t }) => {
            const run = t.status === 'running';
            return h('div', { class: 'change' },
              run ? h('span', { class: 'dots' }, h('b'), h('b'), h('b')) : h('span', { class: 'teal-ink' }, icon('check')),
              h('div', { class: 'grow' }, h('b', { class: 'ellipsis', text: t.label || t.tool }), toolSummary(t) ? h('small', { class: 'ellipsis', text: toolSummary(t) }) : null),
              String(m.id) === undoTarget() && !busy() && (t.diff || /file|drive/.test(t.tool || '')) ? kit.btn('Undo', undo, { kind: 'ghost', icon: 'undo', compact: true }) : null);
          }))) : null,
        h('div', { class: 'card rail-card' }, kit.section('It can see'),
          h('div', { class: 'sees' }, see.map(([ic, k, v]) => h('div', { class: 'see' }, icon(ic), h('b', { text: k }), h('span', { class: 'ellipsis', text: v }))))),
        chat.enabled ? h('div', { class: 'card rail-card' }, kit.section('Try'),
          h('div', { class: 'stack8' }, SUGGESTIONS.slice(0, 3).map((t) => h('button', { class: 'try', onclick: () => { ta.value = t; send(false); } }, icon('spark'), h('span', { class: 'ellipsis', text: t }))))) : null);
    }
    api.get('/api/drive/usage', { quiet: true }).then((d) => { driveInfo = d ? { used: d.used ?? d.used_bytes, files: d.files ?? d.file_count } : null; paintRail(); }).catch(() => {});

    function render() {
      const wasNear = stick;
      renderTranscript();
      paintStatus();
      paintChrome();
      paintRail();
      if (wasNear) requestAnimationFrame(() => scrollEnd());
      else toBottom.hidden = false;
    }

    // ---- composer behaviour ----
    function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight) + 'px'; }
    ta.addEventListener('input', () => { autosize(); paintSend(); saveDraftSoon(); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send((e.ctrlKey || e.metaKey) && !!chat.busy);
      } else if (e.key === 'ArrowUp' && !ta.value && !editing && !busy()) {
        const lastUser = [...(chat.messages || [])].reverse().find((m) => m.role === 'user');
        if (lastUser) { e.preventDefault(); beginEdit(lastUser); }
      } else if (e.key === 'Escape' && editing) { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
      else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); const safe = ['ask', 'auto', 'plan']; setMode(safe[(safe.indexOf(chat.mode || 'auto') + 1) % safe.length]); }
    });
    ta.addEventListener('paste', (e) => {
      if ([...(e.clipboardData?.items || [])].some((it) => it.kind === 'file' && /^image\//.test(it.type))) { e.preventDefault(); pasteImage(); }
    });
    msgs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action="copy-code"]');
      if (b) { copy(b.dataset.code || ''); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); return; }
      const img = e.target.closest('.md-image');
      if (img) { e.preventDefault(); simpleLightbox([{ url: img.src, name: img.alt }], 0); return; }
      const a = e.target.closest('a[href]');
      if (a && /^https?:/.test(a.getAttribute('href'))) { e.preventDefault(); openUrl(a.getAttribute('href')); }
    });
    ctx.dropHandler = { label: 'Drop to attach', fn: attach };

    // A message as plain text: markdown marks go, code and table cells stay as written.
    function plainText(md) {
      return String(md || '').replace(/```[^\n]*\n([\s\S]*?)```/g, '$1').replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, '$1').replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1$2').replace(/`([^`\n]+)`/g, '$1').replace(/^\s*>\s?/gm, '').trim();
    }
    function quote(text) {
      const q = plainText(text).split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
      ta.value = q + ta.value;
      autosize(); ta.focus(); ta.setSelectionRange(q.length, q.length); paintSend();
    }

    // ---- menus ----
    async function msgMenu(e, m) {
      if (window.getSelection()?.toString()) return; // the user is copying a selection: leave the native menu alone
      e.preventDefault();
      const idle = !busy();
      const items = [{ key: 'copy', label: 'Copy', icon: 'copy' }, { key: 'md', label: 'Copy as Markdown', icon: 'code' }, { key: 'quote', label: 'Quote in reply', icon: 'quote' }];
      if (m.role === 'user' && m.id !== 'pending') items.push({ separator: true }, { key: 'edit', label: 'Edit and resend', icon: 'edit', disabled: !idle });
      if (m.role === 'assistant') {
        const more = [];
        if (String(m.id) === lastAssistant()) more.push({ key: 'retry', label: 'Retry', icon: 'refresh', disabled: !idle });
        if (String(m.id) === undoTarget()) more.push({ key: 'undo', label: 'Undo file change', icon: 'undo', disabled: !idle });
        if (more.length) items.push({ separator: true }, ...more);
      }
      const k = await kit.menu(e.clientX, e.clientY, m.role === 'user' ? 'Your message' : 'Assistant', items);
      if (k === 'copy') copy(plainText(m.text || ''));
      else if (k === 'md') copy(m.text || '');
      else if (k === 'quote') quote(m.text || '');
      else if (k === 'edit') beginEdit(m);
      else if (k === 'retry') retry(m.id);
      else if (k === 'undo') undo();
    }
    async function plusMenu(anchor) {
      const r = anchor.getBoundingClientRect();
      const k = await kit.menu(r.left, r.top - 8 - 4 * 30, '', [
        { key: 'files', label: 'Files from this PC…', icon: 'clip' },
        { key: 'drive', label: 'From your Drive…', icon: 'drive' },
        { key: 'paste', label: 'Paste a picture', icon: 'image', hint: 'Ctrl V' },
      ]);
      if (k === 'files') attach(await pickFiles({ title: 'Attach files', multiple: true }));
      else if (k === 'drive') drivePicker();
      else if (k === 'paste') pasteImage();
    }
    async function headMenu(anchor) {
      const k = await kit.menuAt(anchor, 'Assistant', [
        { key: 'new', label: 'New chat', icon: 'plus', hint: 'Ctrl N', disabled: !(chat.messages || []).length },
        { key: 'model', label: 'Switch model…', icon: 'sliders' },
        { key: 'settings', label: 'Change AI…', icon: 'gear' },
        { key: 'usage', label: 'Usage…', icon: 'tasks' },
      ], { right: true });
      if (k === 'new') newChat();
      else if (k === 'model') modelMenu(modelChip);
      else if (k === 'settings') settingsSheet();
      else if (k === 'usage') usageSheet();
    }
    function modeMenu(anchor) {
      const r = anchor.getBoundingClientRect();
      kit.menu(r.right - 280, r.top - 8 - (MODES.length * 30 + 30), 'Permissions · Shift+Tab', MODES.map((m) => ({ key: m.id, label: m.title, hint: m.note, checked: (chat.mode || 'auto') === m.id, danger: m.id === 'dangerous' })), { width: 280 })
        .then((k) => { if (k) setMode(k); });
    }
    // Model · effort: the engine's models, each with the efforts it takes (effort is kept per engine and model).
    async function modelMenu(anchor) {
      const r = anchor.getBoundingClientRect();
      let s;
      try { s = await api.get('/api/assistant/settings', { quiet: true }); } catch (e) { kit.toast(e.message || 'Could not load models.'); return; }
      let models = s.engine === 'free' ? s.free_models || [] : s.engine === 'claude' || s.engine === 'anthropic' ? s.claude_models || [] : [];
      if (s.engine === 'openai') {
        const m = await api.get('/api/assistant/models?base_url=' + encodeURIComponent(s.base_url || ''), { quiet: true }).catch(() => null);
        models = m?.models || [];
        if (m?.error) kit.toast(m.error);
      }
      const effortFor = (id) => { if (s.model === id && s.effort) return s.effort; for (const slot in s.efforts || {}) if (s.efforts[slot]?.[id]) return s.efforts[slot][id]; return ''; };
      const ctxText = (n) => (n ? (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : Math.round(n / 1000) + 'k') : '');
      const items = models.map((m) => {
        const efforts = m.efforts || [];
        const label = m.name || m.id;
        if (!efforts.length) return { key: JSON.stringify([m.id, '']), label, hint: ctxText(m.context_window), checked: s.model === m.id };
        return { key: 'm:' + m.id, label, hint: (s.model === m.id ? (effortFor(m.id) || 'default') : '') || ctxText(m.context_window), checked: s.model === m.id,
          sub: efforts.map((e) => ({ key: JSON.stringify([m.id, e]), label: e.charAt(0).toUpperCase() + e.slice(1), checked: s.model === m.id && effortFor(m.id) === e })) };
      });
      if (!items.length) items.push({ key: 'none', label: 'No models available', disabled: true });
      items.push({ separator: true }, { key: 'settings', label: 'Change AI…', icon: 'gear' });
      const height = Math.min(items.length * 29 + 40, innerHeight * 0.7);
      const k = await kit.menu(Math.max(8, r.right - 320), r.top - 8 - height, `Model · ${String(s.engine).toUpperCase()}`, items, { width: 320 });
      if (!k || k === 'none') return;
      if (k === 'settings') return settingsSheet();
      const [model, effort] = JSON.parse(k);
      const body = { engine: s.engine, model };
      if (effort) body.effort = effort;
      if (s.engine === 'openai') body.base_url = s.base_url;
      try { await api.post('/api/assistant/settings', body, { readOnly: true }); load(); } catch {}
    }

    // ---- lightbox: every picture in the chat, ← → between them ----
    function lightbox(id) {
      const pics = [];
      for (const m of messages()) for (const f of m.files || []) if (/^image\//.test(f.mime || '') && !pics.some((p) => p.id === f.id)) pics.push({ id: f.id, name: f.name || 'Picture', url: fileUrl(f) });
      const at = pics.findIndex((p) => p.id === id);
      if (at >= 0) simpleLightbox(pics, at);
    }
    function simpleLightbox(pics, at) {
      const img = h('img', { alt: '' });
      const label = h('span', { class: 'image-viewer-label' });
      const show = () => { img.src = pics[at].url; img.alt = pics[at].name; label.textContent = `${pics[at].name}${pics.length > 1 ? `  ·  ${at + 1} of ${pics.length}` : ''}`; };
      const step = (by) => { if (pics.length > 1) { at = (at + by + pics.length) % pics.length; show(); } };
      const ov = h('div', { class: 'preview', onclick: (e) => { if (e.target === ov || e.target.classList.contains('pv-stage')) close(); } },
        pics.length > 1 ? h('button', { class: 'pv-nav left', onclick: () => step(-1) }, icon('left')) : null,
        h('div', { class: 'pv-stage' }, img),
        pics.length > 1 ? h('button', { class: 'pv-nav right', onclick: () => step(1) }, icon('right')) : null,
        h('div', { class: 'pv-cap' }, label, h('span', { class: 'grow' }), kit.btn('Copy picture link', () => copy(pics[at].url), { icon: 'link', compact: true }), kit.btn('Close', () => close(), { icon: 'close', compact: true })));
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1); };
      function close() { document.removeEventListener('keydown', onKey, true); ov.remove(); }
      document.addEventListener('keydown', onKey, true);
      document.body.append(ov);
      show();
    }

    // ---- assistant settings: who answers (free models, Claude plan, Claude API, another API) and the keys ----
    async function settingsSheet() {
      let s;
      try { s = await api.get('/api/assistant/settings'); } catch { return; }
      let engine = s.engine;
      let baseUrl = s.base_url || s.presets?.[0]?.base_url || '';
      let signin = '';
      let poll = 0;
      const err = h('div', { class: 'overdue' });
      const note = h('div', { class: 'ok-ink' });
      const keyF = kit.field({ type: 'password' });
      const codeF = kit.field({ placeholder: 'Paste the code from claude.com', onenter: () => finishSignin() });
      const engineList = h('div', { class: 'engine-list' });
      const presetRow = h('div', { class: 'row wrap' });
      const claudeBox = h('div', { class: 'stack8' });
      const keyBox = h('div', { class: 'stack8' });
      const saveBtn = kit.btn('Save', () => save(), { kind: 'primary' });
      const hasKey = () => !!s.has_key?.[engine === 'openai' ? 'openai:' + baseUrl : engine];
      function paint() {
        swap(engineList, (s.engines || []).map((e) => {
          const on = engine === e.id && (e.id !== 'openai' || !e.base_url || baseUrl === e.base_url);
          return h('button', { class: `engine ${on ? 'on' : ''}`, onclick: () => { engine = e.id; if (e.id === 'openai' && e.base_url) baseUrl = e.base_url; err.textContent = ''; note.textContent = ''; keyF.value = ''; paint(); } },
            h('i', { class: 'radio' }), h('div', { class: 'col grow' }, h('b', { text: e.name }), e.note ? h('small', { class: 'muted', text: e.note }) : null));
        }));
        presetRow.hidden = engine !== 'openai';
        swap(presetRow, (s.presets || []).map((p) => kit.btn(p.name, () => { baseUrl = p.base_url; keyF.value = ''; paint(); }, { kind: 'subtle', compact: true, cls: baseUrl === p.base_url ? 'active' : '' })));
        claudeBox.hidden = engine !== 'claude';
        swap(claudeBox,
          h('div', { class: 'row' }, kit.btn(signin === 'starting' ? 'Opening claude.com…' : hasKey() ? 'Sign in again' : 'Sign in with Claude', () => startSignin(), { kind: hasKey() ? '' : 'primary', disabled: !!signin || !s.claude_ready }),
            hasKey() && !signin ? h('span', { class: 'ok-ink', text: '✓ Connected as Claude Pro/Max' }) : null),
          signin && signin !== 'starting' ? [h('small', { class: 'muted', text: signin === 'waiting' ? 'Paste the code from claude.com' : signin === 'checking' ? 'Checking your Claude plan…' : 'Connecting…' }),
            h('div', { class: 'row' }, codeF, kit.btn(signin === 'waiting' ? 'Connect' : 'Connecting…', () => finishSignin(), { kind: 'primary', disabled: signin !== 'waiting' }))] : null,
          !s.claude_ready ? h('small', { class: 'faint', text: "Claude Code isn't installed on the server yet: this choice will work once it is." }) : null,
          s.claude_model_source === 'fallback' ? h('small', { class: 'faint', text: 'Using the default Claude model list.' }) : null);
        keyBox.hidden = engine === 'free' || engine === 'claude';
        keyF.placeholder = hasKey() ? '•••••••• (saved; paste to replace)' : engine === 'anthropic' ? 'sk-ant-api…' : 'Your API key';
        swap(keyBox, kit.labeled('API key', keyF), engine === 'openai' && baseUrl.includes('api.deepseek.com') ? h('a', { href: 'https://platform.deepseek.com/api_keys', text: 'Get a DeepSeek API key' }) : null);
        saveBtn.disabled = !(engine === 'free' || engine === 'claude' ? true : hasKey() || keyF.value.trim());
      }
      keyF.addEventListener('input', paint);
      async function save() {
        err.textContent = '';
        saveBtn.disabled = true;
        saveBtn.querySelector('.lbl').textContent = 'Checking…';
        const body = { engine };
        if (engine === 'openai') body.base_url = baseUrl;
        if (keyF.value.trim()) body.key = keyF.value.trim();
        try { await api.post('/api/assistant/settings', body, { readOnly: true, quiet: true }); sh.close(); load(); }
        catch (e) { err.textContent = e.message; saveBtn.querySelector('.lbl').textContent = 'Save'; paint(); }
      }
      // Claude plan: Claude Code's own sign-in runs on the server; claude.com shows a code at the end, which comes back here.
      async function startSignin() {
        err.textContent = ''; note.textContent = ''; signin = 'starting'; paint();
        try {
          const d = await api.post('/api/assistant/claude/login', {}, { readOnly: true, quiet: true });
          signin = 'waiting'; paint();
          openUrl(d.url);
          codeF.focus();
          clearInterval(poll);
          poll = setInterval(async () => {
            const st = await api.get('/api/assistant/claude/login/status', { quiet: true }).catch(() => null);
            if (!st) return;
            if (st.state === 'connected') { clearInterval(poll); signin = ''; codeF.value = ''; engine = 'claude'; s = await api.get('/api/assistant/settings').catch(() => s); note.textContent = st.message || 'Connected as Claude Pro/Max'; paint(); }
            else if (st.state === 'error') { clearInterval(poll); signin = ''; err.textContent = st.message; paint(); }
            else if (st.state === 'checking') { signin = 'checking'; paint(); }
          }, 1000);
        } catch (e) { signin = ''; err.textContent = e.message || 'Could not start the sign-in.'; paint(); }
      }
      async function finishSignin() {
        if (!codeF.value.trim()) return;
        signin = 'connecting'; paint();
        try { await api.post('/api/assistant/claude/login/code', { code: codeF.value.trim(), async: true }, { readOnly: true, quiet: true }); }
        catch (e) { signin = ''; err.textContent = e.message; paint(); }
      }
      const sh = kit.sheet({
        title: 'Assistant AI', subtitle: 'Pick who answers. Keys are stored encrypted on your account.',
        body: [engineList, presetRow, claudeBox, keyBox, err, note],
        footer: [h('span', { class: 'grow' }), kit.btn('Cancel', () => sh.close()), saveBtn],
        onClose: () => { clearInterval(poll); if (signin) api.post('/api/assistant/claude/login/cancel', {}, { readOnly: true, quiet: true }).catch(() => {}); },
      });
      paint();
    }

    // ---- usage: tokens and cost per day, per engine; the context; limits ----
    async function usageSheet() {
      const body = h('div', { class: 'stack12' }, h('div', { class: 'quiet', text: 'Reading usage…' }));
      const s = kit.sheet({ title: 'Assistant usage', subtitle: 'The last 30 days', size: 'wide', body: [body], footer: [h('span', { class: 'grow' }), kit.btn('Close', () => s.close())] });
      let u;
      try { u = await api.get('/api/assistant/usage?days=30'); } catch (e) { swap(body, h('div', { class: 'overdue', text: e.message })); return; }
      const money = (c) => (c == null ? '—' : '$' + Number(c).toFixed(c < 1 ? 4 : 2));
      const max = Math.max(1, ...u.days.map((d) => d.tokens || 0));
      const stat = (label, value, sub) => h('div', { class: 'card stat' }, h('small', { class: 'muted', text: label }), h('b', { class: 'tnum', text: value }), sub ? h('small', { class: 'faint', text: sub }) : null);
      swap(body,
        h('div', { class: 'stats' },
          stat('Today', tokens(u.today?.tokens), `${U.plural(u.today?.runs || 0, 'run')} · ${money(u.today?.cost)}`),
          stat('30 days', tokens(u.totals?.tokens), `${U.plural(u.totals?.runs || 0, 'run')} · ${money(u.totals?.cost)}`),
          stat('Context', u.context?.percent != null ? `${Number(u.context.percent).toFixed(1).replace(/\.0$/, '')}%` : '—', u.context?.window ? `of ${tokens(u.context.window)} tokens` : ''),
          stat('Model', [u.engine_name, String(u.model || '').replace(/^opencode\//, '')].filter(Boolean).join(' · ') || '—', u.effort ? `effort ${u.effort}` : '')),
        kit.section('Per day', 'tokens'),
        h('div', { class: 'bars' }, u.days.map((d) => h('div', { class: 'bar', 'data-tip': `${d.date} · ${tokens(d.tokens)} tokens · ${U.plural(d.runs, 'run')} · ${money(d.cost)}` }, h('i', { style: { height: `${Math.max(d.tokens ? 3 : 0, (d.tokens || 0) / max * 100)}%` } })))),
        u.engines?.length ? [kit.section('Per engine'), h('div', { class: 'timeline' }, u.engines.map((e) => h('div', { class: 'tl-row static' }, h('span', { class: 'tm', text: e.engine }), h('i'), h('span', { class: 'ttl ellipsis', text: (e.models || []).join(', ') }), h('span', { class: 'muted tnum', text: `${tokens(e.tokens)} · ${U.plural(e.runs, 'run')}` }), h('span', { class: 'muted tnum', text: money(e.cost) }))))] : null,
        kit.section('Limits'),
        h('small', { class: 'muted', text: [u.limits?.plan ? `Plan: ${u.limits.plan}` : '', u.limits?.messages_per_hour ? `${u.limits.messages_per_hour} messages an hour` : '', u.limits?.max_queued ? `up to ${u.limits.max_queued} queued` : '', u.deepseek?.line && /deepseek/i.test(chat.engine_name || '') ? u.deepseek.line : ''].filter(Boolean).join('  ·  ') }),
        u.quota ? h('div', { class: 'sync-alert', text: `Limit reached${u.quota.resets_at ? `, continues at ${U.clock(u.quota.resets_at)}` : ''}${u.quota.message ? ' · ' + u.quota.message : ''}` }) : null,
        u.totals?.unpriced_runs ? h('small', { class: 'faint', text: `${U.plural(u.totals.unpriced_runs, 'run')} without a known price.` }) : null);
    }

    // ---- start ----
    api.get('/api/drive/info', { quiet: true }).then((d) => { info = d; rows.clear(); msgs.replaceChildren(); render(); }).catch(() => {});
    load().then(() => {
      if (arg?.send) { ta.value = arg.send; send(false); }
      if (arg?.settings) settingsSheet();
      if (arg?.usage) usageSheet();
    });
    queueMicrotask(() => ta.focus());
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); newChat(); } };
    document.addEventListener('keydown', onKey);
    // Seconds count on the status line while it works; a running timer card counts down.
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (busy()) paintStatus();
      for (const el of msgs.querySelectorAll('[data-timer-end]')) { const big = el.querySelector('.rc-big'); if (big) big.textContent = U.countdown((Number(el.dataset.timerEnd) - Date.now()) / 1000); }
    }, 1000);
    // The snapshot stays the source of truth: a slow poll catches anything the stream missed.
    const poll = setInterval(() => { if (document.visibilityState === 'visible' && !busy()) load(); }, 15000);
    return {
      update(w) { if (w === 'go') { ta.focus(); } },
      unmount() {
        saveDraft();
        stream.close();
        clearInterval(tick);
        clearInterval(poll);
        clearTimeout(flushTimer);
        document.removeEventListener('keydown', onKey);
      },
    };
  },
};
