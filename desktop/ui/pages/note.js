// A note, written like a word processor (NoteEditor.qml): fonts, sizes, bold/italic/underline/strike, headings,
// lists and to-dos, pictures and files. Saves 600 ms after the last change and when you leave; versions keep
// older text.
import { h, icon, swap, debounce } from '../dom.js';
import * as NF from '../noteformat.mjs';
import { noteCard, todosOf } from './parts.js';
import { createEditor, FONTS, SIZES } from '../editor.js';
import { pickFiles, openPath } from '../native.js';

export default {
  mount(root, ctx, note) {
    const { api, state, U, kit } = ctx;
    if (!note) { ctx.go('notes'); return {}; }
    let current = note;
    let savedBody = note.body || '';
    let savedTitle = note.title || '';
    let info = null;
    let saveTimer = 0;
    let saving = Promise.resolve();
    let writes = 0;
    let loadedMd = ''; // the editor's own Markdown for the body it last loaded: unchanged since then = nothing to save
    const status = h('span', { class: 'note-status faint' });
    const setStatus = (t, cls = '') => { status.textContent = t; status.className = `note-status ${cls || 'faint'}`; };

    const editor = createEditor({
      onChange: () => edited(),
      onOpenFile: async (id) => { const d = await api.get(`/api/files/${id}/local`).catch(() => null); if (d?.path) openPath(d.path); },
      fileUrl: (id) => (info ? info.file_base + id + '?k=' + info.key : ''),
      onToggleTodo: () => { clearTimeout(saveTimer); save(); railSoon(); },
    });

    const titleF = h('input', { class: 'note-title', placeholder: 'Title', value: savedTitle, spellcheck: 'true' });
    titleF.addEventListener('input', () => edited());
    titleF.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(false); } });

    function load(md) { editor.load(md); loadedMd = editor.markdown(); }
    // The rail follows the text (checklist count, attachments) a moment after typing stops; versions after a save.
    const railSoon = debounce(() => paintRail(), 300);
    const versionsSoon = debounce(() => loadVersions(), 3000);
    let railMinute = '';
    function edited() { setStatus('Edited'); clearTimeout(saveTimer); saveTimer = setTimeout(save, 600); railSoon(); }
    function save() {
      clearTimeout(saveTimer);
      saveTimer = 0;
      writes++;
      const md = editor.markdown();
      const title = titleF.value;
      // Compare with the last acknowledged save when this request reaches the queue.
      // Failed writes must stay dirty, so Ctrl+S can retry them.
      saving = saving.then(async () => {
        const patch = {};
        if (title !== savedTitle) patch.title = title;
        if (md !== savedBody) patch.body = md;
        if (!Object.keys(patch).length) { if (editor.markdown() === savedBody && titleF.value === savedTitle) setStatus('Saved'); return; }
        setStatus('Saving…');
        try {
          const n = await api.put('/api/notes/' + current.id, patch);
          if (n) current = { ...current, ...n };
          savedBody = md; savedTitle = title;
          setStatus(editor.markdown() === md && titleF.value === title ? 'Saved' : 'Edited');
          versionsSoon();
        } catch { setStatus('Not saved', 'overdue'); }
      });
      return saving;
    }
    const flush = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; return save(); } return saving; };
    // The page shows what the server has. The note it was opened with can be stale (the list was read before the
    // assistant or another device changed it), so the server copy replaces it while nothing here is unsaved;
    // saving the stale copy would quietly undo that change, ticks included.
    const clean = () => !saveTimer && [savedBody, loadedMd].includes(editor.markdown()) && titleF.value === savedTitle;
    async function syncFromServer() {
      const at = writes;
      await saving;
      const n = await api.get('/api/notes/' + current.id, { quiet: true }).catch(() => null);
      if (!n || n.deleted || writes !== at || !clean()) return;
      if ((n.body || '') === savedBody && (n.title || '') === savedTitle) return;
      current = { ...current, ...n };
      savedBody = n.body || ''; savedTitle = n.title || '';
      titleF.value = savedTitle;
      load(savedBody);
      paintMeta();
    }

    // ---- which course and which day; changes save at once ----
    const coursePick = kit.picker({ options: ctx.courseOptions(true), value: current.course_id || null, title: 'Course', onChange: (v) => move({ course_id: v }), width: 240 });
    const dateF = kit.field({ value: current.session_date || '', placeholder: 'No date' });
    dateF.style.width = '130px';
    dateF.addEventListener('change', () => { const t = dateF.value.trim(); if (t === '' || U.isDate(t)) move({ session_date: t || null }); else dateF.classList.add('invalid'); });
    const dayLabel = h('span', { class: 'muted ellipsis grow' });
    const prevDay = kit.btn('', () => move({ session_date: U.addDays(current.session_date, -1) }), { icon: 'left', compact: true, title: 'Day before' });
    const nextDay = kit.btn('', () => move({ session_date: U.addDays(current.session_date, 1) }), { icon: 'right', compact: true, title: 'Day after' });
    const todayBtn = kit.btn('Today', () => move({ session_date: current.session_date ? null : U.dayOf(state.clock) }), { kind: 'subtle', compact: true });
    async function move(patch) {
      await flush();
      const n = await api.put('/api/notes/' + current.id, patch).catch(() => null);
      if (n) { current = { ...current, ...n }; setStatus('Saved'); paintMeta(); }
    }
    function paintMeta() {
      const dated = !!current.session_date;
      dateF.value = current.session_date || '';
      dateF.classList.remove('invalid');
      dayLabel.textContent = dated ? U.longDate(current.session_date) : 'Not tied to a day';
      prevDay.disabled = nextDay.disabled = !dated;
      todayBtn.querySelector('.lbl').textContent = dated ? 'Clear date' : 'Today';
      coursePick.set(current.course_id || null);
      pinBtn.classList.toggle('pinned', !!current.pinned);
      paintHead();
      const c = ctx.courseById(current.course_id);
      root.style.setProperty('--c', c ? c.color : 'var(--accent)');
    }

    // ---- toolbar ----
    const fontPick = kit.picker({ options: FONTS.map((f) => ({ label: f, value: f })), value: FONTS[0], title: 'Font', onChange: (v) => { editor.format({ font: v }); }, width: 150 });
    const sizePick = kit.picker({ options: SIZES.map((s) => ({ label: String(s), value: s })), value: 15, title: 'Size', onChange: (v) => editor.format({ size: v }), width: 78 });
    fontPick.classList.add('compact'); sizePick.classList.add('compact');
    const tool = (ic, title, fn, label) => { const b = kit.btn(label || '', fn, { kind: 'subtle', icon: ic, compact: true, title }); b.addEventListener('mousedown', (e) => e.preventDefault()); return b; };
    const tb = {
      b: tool('bold', 'Bold (Ctrl+B)', () => editor.toggle('b')),
      i: tool('italic', 'Italic (Ctrl+I)', () => editor.toggle('i')),
      u: tool('underline', 'Underline (Ctrl+U)', () => editor.toggle('u')),
      s: tool('strike', 'Strike through', () => editor.toggle('s')),
      h1: tool('heading', 'Big heading', () => editor.setHeading(1), '1'),
      h2: tool('heading', 'Heading', () => editor.setHeading(2), '2'),
      ul: tool('list-ul', 'Bullet list', () => editor.setList('ul')),
      ol: tool('list-ol', 'Numbered list', () => editor.setList('ol')),
      todo: tool('check-square', 'To-do list (click a box to tick it)', () => editor.setList('todo')),
    };
    const sep = () => h('i', { class: 'tsep' });
    const toolbar = h('div', { class: 'note-tools' }, fontPick, sizePick, sep(), tb.b, tb.i, tb.u, tb.s, sep(), tb.h1, tb.h2, tb.ul, tb.ol, tb.todo, sep(),
      tool('image', 'Add pictures (or drop them here)', () => attachPick(true)),
      tool('clip', 'Attach files (or drop them here)', () => attachPick(false)));
    const paintTools = () => {
      const st = editor.here();
      for (const k of ['b', 'i', 'u', 's']) tb[k].classList.toggle('active', st[k]);
      tb.h1.classList.toggle('active', st.h === 1);
      tb.h2.classList.toggle('active', st.h === 2);
      for (const k of ['ul', 'ol', 'todo']) tb[k].classList.toggle('active', st.kind === k);
      fontPick.set(st.font);
      sizePick.set(st.size);
    };
    const onSel = () => { if (editor.el.contains(window.getSelection()?.anchorNode)) paintTools(); };
    document.addEventListener('selectionchange', onSel);
    editor.el.addEventListener('editorstatechange', paintTools);

    // ---- attachments: uploaded to the Drive, then shown in the note where the caret is ----
    async function attach(paths) {
      if (!paths.length) return;
      await flush();
      let folder = null, course = current.course_id || null;
      if (!course) {
        const d = await api.action('list_drive', {}, { quiet: true }).catch(() => null);
        const f = d?.folders?.find((x) => x.name === 'Note attachments');
        folder = f ? f.id : (await api.action('add_folder', { name: 'Note attachments' }).catch(() => null))?.id;
      }
      setStatus(paths.length > 1 ? `Uploading ${paths.length} files…` : 'Uploading…', 'overdue');
      let err = '';
      await Promise.all(paths.map(async (p) => {
        try {
          const f = await api.post('/api/files/upload', { path: p, folder, course, note: current.id }, { readOnly: true });
          if (f?.files) f.files.forEach((x) => editor.insertFile(x)); // a folder: each file in it
          else if (f) editor.insertFile(f);
        } catch (e) { err = e.message; }
      }));
      setStatus(err || 'Edited', err ? 'overdue' : '');
    }
    async function attachPick(images) {
      const paths = await pickFiles({ title: images ? 'Add pictures' : 'Attach files', multiple: true, filters: images ? [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] : undefined });
      attach(paths);
    }
    ctx.dropHandler = { label: 'Drop to attach to this note', fn: attach };

    // ---- versions: older text of this note, newest first; click one to put it back ----
    async function versions() {
      await flush();
      const list = await api.action('note_versions', { note_id: current.id }).catch(() => null);
      if (!list) return;
      const s = kit.sheet({
        title: 'Versions', size: 'wide',
        subtitle: list.length ? 'Click one to restore it. What the note says now is kept as a version too.' : 'No older versions yet. They appear after edits.',
        body: list.map((v) => h('button', { class: 'card hover version', onclick: async () => {
          const n = await api.action('restore_note_version', { version_id: v.version_id }).catch(() => null);
          if (!n) return;
          s.close();
          clearTimeout(saveTimer);
          current = { ...current, ...n };
          savedBody = n.body || ''; savedTitle = n.title || '';
          titleF.value = savedTitle;
          load(savedBody);
          setStatus('Restored');
          paintMeta();
        } },
        h('small', { class: 'muted', text: U.shortDate(U.dayOf(v.saved_at)) + ' ' + U.clock(v.saved_at) + (v.reason === 'conflict' ? '  ·  from another device' : v.reason === 'restore' ? '  ·  before a restore' : '') }),
        h('b', { class: 'ellipsis', text: v.title || 'Untitled' }),
        h('p', { text: U.preview(v.body) || '(empty)' }))),
        footer: [h('span', { class: 'grow' }), kit.btn('Close', () => s.close())],
      });
    }

    const pinBtn = tool('pin', 'Pin to every session of its course', () => api.put('/api/notes/' + current.id, { pinned: !current.pinned }).then((n) => { if (n) { current = { ...current, ...n }; paintMeta(); } }));
    // Back goes where the note was opened from (Now, a session, the assistant), else to Notes.
    const prevPage = sessionStorage.getItem('hg.prevPage');
    const lastPage = () => (prevPage && prevPage !== 'note' && prevPage !== 'login' ? prevPage : 'notes');
    const back = async () => { await flush(); ctx.go(lastPage()); };
    async function remove() {
      if (await kit.confirm('Delete note?', `“${titleF.value || 'Untitled'}” will be removed from every device.`, 'Delete', { danger: true })) {
        clearTimeout(saveTimer);
        saveTimer = 0;
        await api.action('delete_note', { note_id: current.id }).catch(() => null);
        ctx.go(lastPage());
      }
    }
    const moreBtn = tool('more', 'More', async (e) => {
      const k = await kit.menuAt(e.currentTarget, '', [{ key: 'versions', label: 'Versions', icon: 'history' }, { separator: true }, { key: 'delete', label: 'Delete note', icon: 'trash', danger: true }], { right: true, width: 220 });
      if (k === 'versions') versions();
      else if (k === 'delete') remove();
    });
    toolbar.append(h('span', { class: 'grow' }), pinBtn, tool('history', 'Versions: older text of this note', versions), moreBtn);

    // ---- the page: this course's notes, the note, and its rail (live class, checklist, versions, attachments) ----
    const headTitle = h('h1');
    const crumb = h('span', { class: 'ctx' });
    const head = ctx.head({ title: '', back, mid: [status] });
    head.querySelector('h1').replaceWith(headTitle);
    head.insertBefore(crumb, head.querySelector('.mid'));
    const listEl = h('aside', { class: 'note-list' });
    const railEl = h('aside', { class: 'note-rail' });
    const paper = h('div', { class: 'card raised note-paper' }, toolbar,
      h('div', { class: 'note-scroll' }, h('div', { class: 'note-wrap' },
        h('div', { class: 'note-meta' }, coursePick, prevDay, dateF, nextDay, dayLabel, todayBtn),
        titleF,
        editor.el)));
    root.append(head, h('div', { class: 'page flush note-page' }, h('div', { class: 'note-split' }, listEl, paper, railEl)));

    function paintHead() {
      const c = ctx.courseById(current.course_id);
      headTitle.textContent = titleF.value || 'Untitled';
      crumb.textContent = [c ? c.name : 'Inbox', current.session_date ? U.shortDate(current.session_date) : ''].filter(Boolean).join(' · ');
    }
    titleF.addEventListener('input', paintHead);
    function paintList() {
      const all = (state.notes || []).filter((n) => (current.course_id ? n.course_id === current.course_id : !n.course_id));
      const list = all.sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at)).slice(0, 30);
      const c = ctx.courseById(current.course_id);
      listEl.replaceChildren(kit.section(c ? c.name : 'Inbox', U.plural(all.length, 'note')),
        h('div', { class: 'stack8' }, list.map((n) => noteCard(ctx, n, { today: U.dayOf(state.clock), todoMax: 2, showCourse: false, active: n.id === current.id, onclick: () => { if (n.id !== current.id) flush().then(() => ctx.openNote(n)); } }))));
    }
    let versionList = null;
    async function loadVersions() {
      versionList = await api.action('note_versions', { note_id: current.id }, { quiet: true }).catch(() => null);
      paintRail();
    }
    function paintRail() {
      const md = editor.markdown();
      const todos = todosOf(U, md);
      const done = todos.filter((t) => t.done).length;
      const files = NF.parse(md).filter((l) => l.file).map((l) => l.file);
      const a = state.now?.active;
      const live = a && a.state === 'live' && a.course_id && a.course_id === current.course_id ? a : null;
      const c = ctx.courseById(current.course_id);
      const left = live ? Math.max(0, Math.ceil((live.end_ms - state.clock) / 60000)) : 0;
      swap(railEl,
        live ? h('section', { class: 'hero live rail-hero note-live', style: { '--c': live.color } },
          h('div', { class: 'top' }, kit.chip('Live', { cls: 'live' }), h('span', { class: 'left tnum' }, h('b', { text: String(left) }), 'min')),
          h('h2', { text: live.title }), h('div', { class: 'meta', text: [U.kindLabel(live.kind), live.location].filter(Boolean).join(' · ') }),
          live.mark !== 'attended' ? h('div', { class: 'acts' }, kit.btn('Mark attended', (e) => { ctx.burstAt(e.currentTarget); api.action('mark_session', { event_id: live.event_id, date: live.session_date || live.date, status: 'attended' }).then(() => ctx.refresh()); }, { icon: 'usercheck', compact: true })) : h('div', { class: 'meta teal-ink', text: '✓ attended' })) : null,
        todos.length ? h('div', { class: 'card rail-card' }, kit.section('Checklist'),
          h('div', { class: 'big-count tnum' }, String(done), h('span', { text: ` / ${todos.length}` })),
          h('div', { class: 'check-bar' }, h('i', { style: { width: `${(done / todos.length) * 100}%` } }))) : null,
        versionList?.length ? h('div', { class: 'card rail-card' }, kit.section('Versions', String(versionList.length)),
          h('div', { class: 'vers' }, h('div', { class: 'ver-row now' }, h('span', { class: 'tnum', text: 'Now' }), h('span', { class: 'grow muted', text: status.textContent || 'Saved' })),
            versionList.slice(0, 4).map((v) => h('button', { class: 'ver-row', onclick: versions, title: 'Restore an older version' },
              h('span', { class: 'tnum', text: U.dayOf(v.saved_at) === U.dayOf(state.clock) ? U.clock(v.saved_at) : U.shortDate(U.dayOf(v.saved_at)).slice(0, 10) }),
              h('span', { class: 'grow muted ellipsis', text: v.reason === 'conflict' ? 'From another device' : v.reason === 'restore' ? 'Before a restore' : v.title || 'Untitled' }))))) : null,
        files.length ? h('div', { class: 'card rail-card' }, kit.section('Attached', String(files.length)),
          h('div', { class: 'stack8' }, files.map((f) => h('button', { class: 'att-file', onclick: async () => { const d = await api.get(`/api/files/${f.id}/local`).catch(() => null); if (d?.path) openPath(d.path); } },
            h('span', { class: 'fbox' }, icon(/\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name || '') ? 'image' : 'file')),
            h('span', { class: 'grow' }, h('b', { class: 'ellipsis', text: f.name || 'File' }), h('small', { text: `Drive · ${c ? c.name : 'Note attachments'}` })))))) : null);
    }

    load(savedBody);
    paintMeta();
    paintList();
    loadVersions();
    api.get('/api/drive/info', { quiet: true }).then((d) => { info = d; editor.refreshFiles(); }).catch(() => {});
    syncFromServer();
    queueMicrotask(() => (savedBody ? null : savedTitle ? editor.focus() : titleF.focus()));

    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    };
    document.addEventListener('keydown', onKey);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    return {
      escape() { back(); return true; },
      update(w) { if (w === 'data') { coursePick.setOptions(ctx.courseOptions(true)); syncFromServer(); paintList(); paintRail(); } else if (w === 'state' || (w === 'tick' && U.hhmmOf(state.clock) !== railMinute)) { railMinute = U.hhmmOf(state.clock); paintRail(); } },
      unmount() {
        flush();
        editor.destroy();
        document.removeEventListener('selectionchange', onSel);
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onHide);
      },
    };
  },
};
