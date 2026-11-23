// Drive: files on the server, in folders; every course has its own folder (DrivePage.qml). Upload with the button or
// by dropping files on the window. Click a file to open it with its app (pictures and videos preview); right-click
// for more. Nothing downloads until it's opened; opened files are watched and uploaded again when saved.
// Drag a file or folder onto a folder, a name in the path, or a course to move it there.
import { h, icon, swap } from '../dom.js';
import { pickFiles, pickFolder, savePath, copy, openPath } from '../native.js';

const VIEW_KEY = 'hg.driveView', SORT_KEY = 'hg.driveSort';

export default {
  mount(root, ctx, arg) {
    const { api, state, U, kit } = ctx;
    let folder = arg?.folder || '';   // '' = the top
    let course = arg?.course || '';   // a course's folder
    let drive = { path: [], folders: [], files: [], courses: [] };
    let usage = null, info = null, shares = {}, allFolders = [], syncFolders = [], localCopies = [];
    let syncedFolders = {}, syncCommands = {}, expandedErrors = {};
    let view = localStorage.getItem(VIEW_KEY) || 'details';
    let sort = JSON.parse(localStorage.getItem(SORT_KEY) || '{"by":"name","desc":false}');
    let problem = '';
    let first = true;

    const crumbs = h('div', { class: 'crumbs' });
    const viewSeg = kit.seg([{ value: 'icons', icon: 'grid', title: 'Icons' }, { value: 'details', icon: 'list', title: 'Details' }, { value: 'gallery', icon: 'gallery', title: 'Gallery' }], view, (v) => { view = v; localStorage.setItem(VIEW_KEY, v); render(); }, { cls: 'icon-seg' });
    const usageEl = h('div', { class: 'usage' });
    const head = ctx.head({ title: 'Drive', mid: [crumbs], acts: [usageEl, viewSeg, kit.btn('Sync folder', () => syncFolderFlow(), { icon: 'sync' }), kit.btn('New folder', () => nameSheet(null), { icon: 'plus' }), kit.btn('Upload', () => uploadPick(), { kind: 'primary', icon: 'upload' })] });
    const body = h('div', { class: 'page-col drive' });
    const pageEl = h('div', { class: 'page' }, body);
    root.append(head, pageEl);

    // ---- loading ----
    async function load() {
      const args = course && folder ? { course_id: course, folder_id: folder } : course ? { course_id: course } : folder ? { folder_id: folder } : {};
      const [d, f] = await Promise.all([
        api.action('list_drive', args, { quiet: true }).catch(() => null),
        api.get('/api/folders', { quiet: true }).catch(() => null),
      ]);
      if (d) drive = d; else if (folder || course) { folder = ''; course = ''; return load(); }
      if (f) allFolders = f;
      render();
    }
    async function loadSync() {
      const [pairs, copies, st] = await Promise.all([
        api.get('/api/syncfolders', { quiet: true }).catch(() => null),
        api.get('/api/localcopies', { quiet: true }).catch(() => null),
        api.get('/api/syncstate', { quiet: true }).catch(() => null),
      ]);
      if (pairs) {
        syncFolders = pairs.filter((p) => p.mode !== 'pull');
        for (const id of Object.keys(syncCommands)) {
          const p = pairs.find((x) => x.id === id);
          if (!p || (syncCommands[id] === 'waiting' && p.state !== 'paused')) delete syncCommands[id];
        }
      }
      if (copies) localCopies = copies;
      if (st) { syncedFolders = {}; for (const id of st.folder_ids || []) syncedFolders[id] = true; }
      render();
    }
    // Links live on the server only: read when the page opens, after a change, and every minute.
    async function loadShares() {
      const list = await api.get('/api/shares', { quiet: true }).catch(() => null);
      if (!list) return;
      shares = {};
      for (const s of list) if (s.active) shares[s.file_id || s.folder_id] = s;
      render();
    }
    async function loadUsage() { usage = await api.get('/api/drive/usage', { quiet: true }).catch(() => usage); loadShares(); paintUsage(); }
    function go(f, c) { folder = f || ''; course = c || ''; first = true; load(); }

    // ---- helpers ----
    const isImage = (f) => /^image\//.test(f.mime || '') && !/svg/.test(f.mime);
    const isVideo = (f) => /^video\//.test(f.mime || '') || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name);
    const isAudio = (f) => /^audio\//.test(f.mime || '');
    const src = (f, extra = '') => (info ? info.file_base + f.id + '?k=' + info.key + '&v=' + f.updated_at + extra : '');
    const thumb = (f) => (info?.thumb_base ? info.thumb_base + f.id + '?k=' + info.key + '&v=' + f.updated_at : '');
    function typeOf(f, isFolder) {
      if (isFolder) return 'Folder';
      if (isImage(f)) return 'Picture';
      if (isVideo(f)) return 'Video';
      const ext = (/\.([a-z0-9]{1,6})$/i.exec(f.name) || [])[1];
      return ext ? ext.toUpperCase() + ' file' : 'File';
    }
    const fileIcon = (f) => (isImage(f) ? 'image' : isVideo(f) ? 'video' : isAudio(f) ? 'music' : /pdf/.test(f.mime || '') ? 'file-pdf' : /zip|compressed|tar/.test(f.mime || '') ? 'file-zip' : /^text\//.test(f.mime || '') ? 'file-text' : 'file');
    // One unit family everywhere: bytes as they are, KB to GB with one decimal, TB and up with two.
    function size(n) {
      if (n == null) return '';
      n = Number(n);
      if (!isFinite(n) || n < 0) return '';
      if (n < 1024) return Math.round(n) + ' B';
      const u = ['KB', 'MB', 'GB', 'TB', 'PB'];
      let i = -1;
      while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
      return n.toFixed(i >= 3 ? 2 : 1) + ' ' + u[i];
    }
    function items() {
      const key = sort.by, dir = sort.desc ? -1 : 1;
      const val = (f, isF) => (key === 'size' ? (isF ? f.items || 0 : f.size || 0) : key === 'date' ? f.updated_at || 0 : key === 'type' ? typeOf(f, isF) : f.name.toLowerCase());
      const by = (isF) => (a, b) => { const x = val(a, isF), y = val(b, isF); return (x < y ? -1 : x > y ? 1 : 0) * dir || a.name.localeCompare(b.name); };
      return [...drive.folders.slice().sort(by(true)).map((r) => ({ table: 'folders', row: r })), ...drive.files.slice().sort(by(false)).map((r) => ({ table: 'files', row: r }))];
    }
    function sortOn(k) {
      sort = sort.by === k ? { by: k, desc: !sort.desc } : { by: k, desc: k === 'date' || k === 'size' };
      localStorage.setItem(SORT_KEY, JSON.stringify(sort));
      render();
    }
    function courseFor(it) {
      if (it.courseCard) return { id: it.row.id, name: it.row.name };
      if (it.table !== 'folders') return null;
      let id = course;
      if (!id) for (let i = (drive.path || []).length - 1; i >= 0; i--) if (drive.path[i].course) { id = drive.path[i].id; break; }
      if (!id) {
        let parentId = it.row.parent_id || folder;
        for (let i = 0; parentId && i < 20; i++) {
          const c = state.courses.find((x) => x.id === parentId);
          if (c) { id = c.id; break; }
          parentId = allFolders.find((x) => x.id === parentId)?.parent_id || '';
        }
      }
      if (!id) return null;
      const c = state.courses.find((x) => x.id === id);
      return { id, name: c ? c.name : it.row.name };
    }
    const localCopyFor = (cid) => localCopies.find((x) => x.course_id === cid) || null;
    const pairForFolder = (fid) => syncFolders.find((p) => p.folder_id === fid) || null;
    const isFolderSynced = (fid) => !!fid && (syncFolders.some((p) => p.folder_id === fid) || !!syncedFolders[fid]);
    function copyStatus(c) {
      if (!c) return '';
      if (c.state === 'error' || c.error || c.last_error || c.errors?.length) return 'Error';
      if (c.paused || c.state === 'paused') return 'Paused';
      if (c.state === 'syncing') { const d = Number(c.files_done) || 0, t = Number(c.files_total) || 0; return `Downloading ${d} of ${t} · ${t ? Math.round(d * 100 / t) : 0}%`; }
      return 'Synced to this PC';
    }
    const copyError = (c) => c?.error || c?.last_error || c?.errors?.at(-1)?.error || (c?.state === 'error' ? 'Sync failed' : '');
    function syncTime(ms) {
      if (!ms) return 'Never';
      const sec = Math.floor((Date.now() - ms) / 1000);
      if (sec < 10) return 'just now';
      if (sec < 60) return sec + 's ago';
      if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
      return U.shortDate(U.dayOf(ms)) + ' ' + U.clock(ms);
    }
    const setProblem = (p) => { problem = p || ''; render(); };

    // ---- actions ----
    async function upload(paths, into, intoCourse) {
      if (!paths.length) return;
      problem = '';
      const f = into !== undefined ? into : folder || null;
      const c = into !== undefined ? intoCourse || null : course || null;
      await Promise.all(paths.map((p) => api.post('/api/files/upload', { path: p, folder: f, course: c }, { readOnly: true }).catch(() => null)));
      load();
      loadUsage();
    }
    async function uploadPick() { upload(await pickFiles({ title: 'Upload files', multiple: true })); }
    async function openFile(f) {
      kit.toast(`Opening ${f.name}…`);
      try { const d = await api.get(`/api/files/${f.id}/local`, { quiet: true }); if (d?.path) openPath(d.path); } catch (e) { setProblem(e.message); }
    }
    const reveal = (f) => api.post(`/api/files/${f.id}/reveal`, {}, { readOnly: true }).catch((e) => setProblem(e.message));
    const revealFolder = (id) => api.post(`/api/folders/${id}/reveal`, {}, { readOnly: true }).catch((e) => setProblem(e.message));
    const revealPair = (id) => api.post(`/api/syncfolders/${id}/reveal`, {}, { readOnly: true }).catch((e) => setProblem(e.message));
    async function download(f) {
      const p = await savePath({ title: `Download ${f.name}`, defaultPath: f.name });
      if (!p) return;
      kit.toast(`Downloading ${f.name}…`);
      try { await api.post(`/api/files/${f.id}/save`, { path: p }, { readOnly: true }); kit.toast(`Saved ${f.name}`, { kind: 'ok' }); } catch (e) { setProblem(e.message); }
    }
    const setCourse = (f, cid) => api.action('move_file', { file_id: f.id, course: cid }).then(load);
    // A file or folder into a folder (a course's folder takes it into the course too), or with folderId '' to the
    // top of courseId's folder, or of the Drive.
    async function moveInto(it, folderId, courseId) {
      const target = folderId || null;
      const c = target ? undefined : courseId || null;
      try {
        if (it.table === 'folders') {
          if (it.row.id === target) return;
          if ((it.row.parent_id || null) === target && (target || (it.row.course_id || null) === c)) return;
          const args = { folder_id: it.row.id, parent_id: target };
          if (c) args.course_id = c;
          await api.post('/api/actions/move_folder', args);
        } else {
          if ((it.row.folder_id || null) === target && (target || (it.row.course_id || null) === c)) return;
          await api.action('move_file', target || !c ? { file_id: it.row.id, folder_id: target } : { file_id: it.row.id, course: c });
        }
        kit.toast(`Moved ${it.row.name}`, { kind: 'ok' });
      } catch {}
      load();
    }
    function folderChoices(it) {
      const byId = Object.fromEntries(allFolders.map((f) => [f.id, f]));
      const pathOf = (f) => { const names = []; for (let x = f, n = 0; x && n < 20; x = byId[x.parent_id], n++) names.unshift(x.name); return names.join(' / '); };
      const inside = (f) => { for (let x = f, n = 0; x && n < 20; x = byId[x.parent_id], n++) if (x.id === it.row.id) return true; return false; };
      const here = it.table === 'folders' ? it.row.parent_id || null : it.row.folder_id || null;
      const list = allFolders.filter((f) => (course ? f.course_id === course : !f.course_id) && !(it.table === 'folders' && inside(f)))
        .map((f) => ({ key: 'into:' + f.id, label: pathOf(f), checked: here === f.id && !it.row.course_id }))
        .sort((a, b) => a.label.localeCompare(b.label));
      return [{ key: 'into:', label: course ? 'Top of course' : 'Top of the Drive', checked: !here && (it.row.course_id || null) === (course || null) }, { separator: true }, ...list];
    }
    async function remove(it) {
      if (it.table === 'folders') {
        if (await kit.confirm(`Delete ${it.row.name}?`, 'The folder and everything in it are deleted from the server.', 'Delete', { danger: true })) api.action('remove_folder', { folder_id: it.row.id }).then(loadUsage);
      } else if (await kit.confirm(`Delete ${it.row.name}?`, 'It is deleted from the server and every device' + (it.row.note_id ? ', and stops showing in its note.' : '.'), 'Delete', { danger: true })) {
        api.del('/api/files/' + it.row.id).then(loadUsage);
      }
    }
    async function syncCommand(id, action) {
      if (syncCommands[id]) return;
      syncCommands[id] = 'sending';
      render();
      try {
        const pair = await api.post(`/api/syncfolders/${id}/${action}`, {}, { readOnly: true });
        if ((action === 'confirm' || action === 'keep') && pair?.state === 'paused') syncCommands[id] = 'waiting'; else delete syncCommands[id];
      } catch (e) { delete syncCommands[id]; problem = e.message; }
      loadSync();
    }
    async function localCopyCommand(c, action) {
      try { await api.post(`/api/localcopies/${c.id}/${action}`, {}, { readOnly: true }); } catch (e) { problem = e.message; }
      loadSync();
    }
    async function startLocalCopy(c) {
      try { await api.post('/api/localcopies', { course_id: c.id, name: c.name }, { readOnly: true }); kit.toast(`Syncing ${c.name} to this PC`); } catch (e) { problem = e.message; }
      loadSync();
    }

    // ---- sheets ----
    function nameSheet(target) {
      const f = kit.field({ value: target ? target.row.name : '', placeholder: 'Name', onenter: () => save() });
      async function save() {
        const n = f.value.trim();
        if (!n) return;
        try {
          if (!target) await api.action('add_folder', folder ? { name: n, parent_id: folder } : course ? { name: n, course_id: course } : { name: n });
          else await api.put(`/api/${target.table}/${target.row.id}`, { name: n });
          s.close();
        } catch {}
      }
      const s = kit.sheet({ title: target ? 'Rename' : 'New folder', size: 'narrow', body: [f], footer: [h('span', { class: 'grow' }), kit.btn('Cancel', () => s.close()), kit.btn('Save', save, { kind: 'primary' })] });
      queueMicrotask(() => { f.focus(); f.select(); });
    }

    // Share…: a link anyone can open in a browser, view only or view and download.
    function shareSheet(it) {
      let link = shares[it.row.id] || null;
      let access = link ? link.access : 'view';
      let days = 0;
      const note = h('small', { class: 'muted' });
      const linkRow = h('div', { class: 'row' });
      const paintLink = () => swap(linkRow, link ? [h('code', { class: 'ai-link selectable grow ellipsis', text: link.url }), kit.btn('Copy', async () => { await copy(link.url); note.textContent = 'Link copied.'; }, { icon: 'link' })] : null);
      const stopBtn = kit.btn('Stop sharing', async () => {
        try { await api.del('/api/shares/' + link.token, { readOnly: true }); link = null; note.textContent = 'Sharing stopped.'; paintLink(); stopBtn.hidden = true; loadShares(); } catch (e) { note.textContent = e.message; }
      }, { kind: 'danger', icon: 'close' });
      stopBtn.hidden = !link;
      async function make() {
        const body = { access, days: days || undefined };
        if (it.table === 'folders') body.folder_id = it.row.id; else body.file_id = it.row.id;
        try {
          link = await api.post('/api/shares', body, { readOnly: true });
          await copy(link.url);
          note.textContent = 'Link copied.';
          stopBtn.hidden = false;
          paintLink();
          loadShares();
        } catch (e) { note.textContent = e.message; }
      }
      paintLink();
      kit.sheet({
        title: `Share ${it.row.name}`, subtitle: 'Anyone with the link can open it in a browser, no account needed.',
        body: [
          h('div', { class: 'label' }, h('span', { text: 'Who can see it' }), kit.seg([{ label: 'Anyone with the link can view', value: 'view', icon: 'eye' }, { label: '…can view and download', value: 'download', icon: 'download' }], access, (v) => { access = v; })),
          h('div', { class: 'label' }, h('span', { text: 'The link stops working' }), kit.seg([{ label: 'Never', value: 0 }, { label: 'After 1 day', value: 1 }, { label: 'After 7 days', value: 7 }, { label: 'After 30 days', value: 30 }], days, (v) => { days = v; })),
          linkRow, note],
        footer: [stopBtn, h('span', { class: 'grow' }), kit.btn(link ? 'Save and copy link' : 'Create and copy link', make, { kind: 'primary', icon: 'link' })],
      });
    }

    // Versions of a Drive file: the list, what changed, putting one back, saving a copy.
    async function versionsSheet(f) {
      const list = h('div', { class: 'stack8' }, h('div', { class: 'quiet', text: 'Reading the versions…' }));
      const s = kit.sheet({ title: `Versions of ${f.name}`, subtitle: 'Every save keeps the copy before it.', size: 'wide', body: [list], footer: [h('span', { class: 'grow' }), kit.btn('Close', () => s.close())] });
      const when = (ms) => (ms ? U.shortDate(U.dayOf(ms)) + '  ' + U.clock(ms) : '');
      const who = (v) => [v.device, v.by].filter(Boolean).join(' · ') || 'unknown device';
      let data;
      try { data = await api.get(`/api/files/${f.id}/versions`); } catch (e) { swap(list, h('div', { class: 'overdue', text: e.message })); return; }
      const diffBox = (v) => {
        const box = h('div', { class: 'diff', text: 'Comparing…' });
        if (data.picture) {
          swap(box, h('div', { class: 'diff-pics' },
            h('figure', {}, h('figcaption', { text: 'THEN' }), h('img', { src: info ? info.file_base + f.id + '?k=' + info.key + '&version=' + v.id : '' })),
            h('figure', {}, h('figcaption', { text: 'NOW' }), h('img', { src: src(f) }))));
          return box;
        }
        api.get(`/api/files/${f.id}/versions/${v.id}/diff`, { quiet: true }).then((d) => {
          if (d.kind !== 'text' || d.tooBig) {
            box.textContent = d.kind === 'binary' ? `This kind of file can't be compared line by line. Then: ${size(d.before)}, now: ${size(d.after)}.` : d.tooBig ? `Too many changes to show here (${d.added} lines in, ${d.removed} out).` : d.error || 'Could not compare them.';
            return;
          }
          swap(box, h('small', { class: 'muted', text: `+${d.added} lines   −${d.removed} lines   (red: only then, green: only now)` }),
            d.lines.map((l) => h('div', { class: `dl ${l.op}`, text: l.op === 'skip' ? `⋯ ${l.count} lines the same` : (l.op === 'add' ? '+ ' : l.op === 'del' ? '− ' : '  ') + l.text })));
        }).catch((e) => { box.textContent = e.message; });
        return box;
      };
      swap(list,
        h('div', { class: 'row ver-now' }, kit.chip('Now', { cls: 'ok' }), h('span', { class: 'muted', text: `${when(data.current.at)}   ${size(data.current.size)}   ${who(data.current)}${data.current.restored_from ? '   (put back from an older version)' : ''}` })),
        data.versions.length ? data.versions.map((v) => {
          const holder = h('div');
          return h('div', { class: 'card ver' },
            h('div', { class: 'row' }, h('div', { class: 'col grow' }, h('b', { text: when(v.at) }), h('small', { class: 'muted', text: `${size(v.size)} · ${who(v)}` })),
              kit.btn('What changed', (e) => { const on = !holder.firstChild; swap(holder, on ? diffBox(v) : null); e.currentTarget.querySelector('.lbl').textContent = on ? 'Hide changes' : 'What changed'; }, { kind: 'subtle', compact: true }),
              kit.btn('', async () => {
                const p = await savePath({ title: 'Save this version', defaultPath: f.name });
                if (p) api.post(`/api/files/${f.id}/versions/${v.id}/save`, { path: p }, { readOnly: true }).then(() => kit.toast(`Saved a copy of the version from ${when(v.at)}`, { kind: 'ok' })).catch(() => {});
              }, { kind: 'subtle', compact: true, icon: 'download', title: 'Save a copy of this version' }),
              kit.btn('Restore', async () => { await api.post(`/api/files/${f.id}/versions/${v.id}/restore`, {}).catch(() => null); s.close(); kit.toast('Version restored', { kind: 'ok' }); load(); }, { compact: true, icon: 'undo', title: "Put this version back (what's there now is kept as a version)" })),
            holder);
        }) : h('div', { class: 'quiet', text: 'No older versions yet. When this file is edited and saved again, the copy before is kept here.' }));
    }

    // Sync folder: a folder on this PC kept in sync with a Drive folder.
    async function syncFolderFlow() {
      const local = await pickFolder('Choose a folder on this PC to sync');
      if (!local) return;
      const byId = Object.fromEntries(allFolders.map((f) => [f.id, f]));
      const pathOf = (f) => { const names = []; for (let x = f, n = 0; x && n < 20; x = byId[x.parent_id], n++) names.unshift(x.name); return names.join(' / '); };
      const opts = allFolders.map((f) => ({ label: pathOf(f), value: f.id })).sort((a, b) => a.label.localeCompare(b.label));
      let mode = opts.length ? 'existing' : 'new', selected = opts[0]?.value || '', parent = '';
      const nameF = kit.field({ value: local.split(/[\\/]/).filter(Boolean).pop() || 'Folder', placeholder: 'New folder name', onenter: () => submit() });
      const existing = h('div', { class: 'stack8' }, opts.length ? kit.picker({ options: opts, value: selected, onChange: (v) => { selected = v; } }) : h('small', { class: 'faint', text: 'No folders on Drive yet. Choose New folder above to create one.' }));
      const fresh = h('div', { class: 'stack8' }, nameF, kit.labeled('Inside (optional)', kit.picker({ options: [{ label: 'Top of Drive (Root)', value: '' }, ...opts], value: '', onChange: (v) => { parent = v; } })));
      const err = h('div', { class: 'overdue' });
      const paint = () => { existing.hidden = mode !== 'existing'; fresh.hidden = mode !== 'new'; };
      const go2 = kit.btn('Start syncing', () => submit(), { kind: 'primary', icon: 'sync' });
      async function submit() {
        const b = { local };
        if (mode === 'new') { const n = nameF.value.trim(); if (!n) { err.textContent = 'Enter a folder name.'; return; } b.folder_name = n; if (parent) b.parent_id = parent; }
        else { if (!selected) { err.textContent = 'Choose a Drive folder.'; return; } b.folder_id = selected; }
        go2.disabled = true;
        try { const r = await api.post('/api/syncfolders', b, { readOnly: true, quiet: true }); s.close(); kit.toast(`Started syncing ${r.folder_path || r.local}`, { kind: 'ok' }); loadSync(); load(); }
        catch (e) { err.textContent = e.message; go2.disabled = false; }
      }
      const s = kit.sheet({
        title: 'Sync with Hourglass Drive', subtitle: 'Keep a folder on this PC and a folder on Hourglass Drive in sync.',
        body: [kit.labeled('Local folder', h('div', { class: 'field ellipsis path-field', text: local })),
          h('div', { class: 'label' }, h('span', { text: 'Destination on Drive' }), kit.seg([{ label: 'Existing folder', value: 'existing', icon: 'folder' }, { label: 'New folder', value: 'new', icon: 'plus' }], mode, (v) => { mode = v; paint(); })),
          existing, fresh, err],
        footer: [h('span', { class: 'grow' }), kit.btn('Cancel', () => s.close()), go2],
      });
      paint();
    }

    // ---- preview: pictures and videos, with ← → through the folder ----
    function preview(f) {
      const media = drive.files.filter((x) => isImage(x) || isVideo(x));
      let at = media.findIndex((x) => x.id === f.id);
      const stage = h('div', { class: 'pv-stage' });
      const caption = h('div', { class: 'pv-cap' });
      const show = () => {
        const cur = media[at];
        swap(stage, isVideo(cur) ? h('video', { src: src(cur), controls: true, autoplay: true }) : h('img', { src: src(cur), alt: cur.name }));
        swap(caption, h('b', { class: 'ellipsis', text: cur.name }), h('span', { class: 'muted', text: `${size(cur.size)} · ${at + 1} of ${media.length}` }), h('span', { class: 'grow' }),
          kit.btn('Open in its app', () => { close(); openFile(cur); }, { icon: 'folder-open' }), kit.btn('Close', () => close(), { icon: 'close' }));
      };
      const step = (by) => { if (media.length > 1) { at = (at + by + media.length) % media.length; show(); } };
      const ov = h('div', { class: 'preview', onclick: (e) => { if (e.target === ov || e.target === stage) close(); } },
        media.length > 1 ? h('button', { class: 'pv-nav left', onclick: () => step(-1) }, icon('left')) : null, stage,
        media.length > 1 ? h('button', { class: 'pv-nav right', onclick: () => step(1) }, icon('right')) : null, caption);
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1); };
      function close() { document.removeEventListener('keydown', onKey, true); ov.remove(); }
      document.addEventListener('keydown', onKey, true);
      document.body.append(ov);
      show();
    }

    // ---- menus ----
    async function openMenu(it, x, y) {
      const f = it.row;
      let items;
      if (it.table === 'folders') {
        const c = courseFor(it);
        const lc = c ? localCopyFor(c.id) : null;
        const paused = lc && (lc.paused || lc.state === 'paused');
        const localItems = c ? (lc ? [{ key: 'lc:reveal', label: 'Open in File Explorer', icon: 'folder-open' }, { separator: true }, { key: paused ? 'lc:resume' : 'lc:pause', label: paused ? 'Resume sync' : 'Pause sync', icon: paused ? 'play' : 'pause' }, { key: 'lc:now', label: 'Sync now', icon: 'sync' }, { key: 'lc:remove', label: 'Stop syncing', danger: true }] : [{ key: 'lc:add', label: 'Sync folder to this PC', icon: 'sync' }]) : [];
        items = it.courseCard ? localItems : [
          { key: 'open', label: 'Open folder', icon: 'folder-open' },
          ...(pairForFolder(f.id) || isFolderSynced(f.id) ? [{ key: 'reveal-folder', label: 'Open in File Explorer', icon: 'external' }] : []),
          { key: 'share', label: shares[f.id] ? 'Shared · link…' : 'Share…', icon: 'link' },
          { key: 'move', label: 'Move to…', icon: 'move', sub: folderChoices(it) },
          { key: 'rename', label: 'Rename', icon: 'edit' },
          ...(c ? [{ separator: true }, ...localItems] : []),
          { separator: true },
          { key: 'delete', label: 'Delete folder', danger: true },
        ];
      } else {
        const media = isImage(f) || isVideo(f);
        items = [
          { key: 'open', label: 'Open', icon: 'external' },
          media ? { key: 'preview', label: 'Preview', icon: 'eye' } : null,
          { key: 'download', label: 'Download…', icon: 'download' },
          { key: 'reveal', label: 'Show in folder', icon: 'folder-open' },
          { key: 'share', label: shares[f.id] ? 'Shared · link…' : 'Share…', icon: 'link' },
          { key: 'versions', label: 'Versions…', icon: 'history' },
          { separator: true },
          { key: 'move', label: 'Move to…', icon: 'move', sub: folderChoices(it) },
          { key: 'course', label: 'Set course', icon: 'courses', sub: [...state.courses.map((c) => ({ key: 'course:' + c.id, label: c.name, color: c.color, checked: f.course_id === c.id })), { separator: true }, { key: 'course:', label: 'No course', disabled: !f.course_id }] },
          { key: 'rename', label: 'Rename', icon: 'edit' },
          { separator: true },
          { key: 'delete', label: 'Delete', danger: true },
        ].filter(Boolean);
      }
      const key = await kit.menu(x, y, f.name, items);
      if (!key) return;
      const c = courseFor(it), lc = c ? localCopyFor(c.id) : null;
      if (key === 'open') it.table === 'folders' ? go(f.id, course) : openFile(f);
      else if (key === 'preview') preview(f);
      else if (key === 'download') download(f);
      else if (key === 'reveal') reveal(f);
      else if (key === 'reveal-folder') revealFolder(f.id);
      else if (key === 'share') shareSheet(it);
      else if (key === 'versions') versionsSheet(f);
      else if (key === 'rename') nameSheet(it);
      else if (key === 'delete') remove(it);
      else if (key.startsWith('course:')) setCourse(f, key.slice(7) || null);
      else if (key.startsWith('into:')) moveInto(it, key.slice(5), course);
      else if (key === 'lc:add') startLocalCopy(c);
      else if (key === 'lc:reveal' && lc) revealPair(lc.id);
      else if (['lc:pause', 'lc:resume', 'lc:now'].includes(key) && lc) localCopyCommand(lc, key.slice(3));
      else if (key === 'lc:remove' && lc && await kit.confirm(`Stop syncing ${c.name}?`, 'The synced course folder will be removed from this PC. The files on Drive will stay.', 'Stop syncing', { danger: true })) {
        api.del('/api/localcopies/' + lc.id, { readOnly: true }).then(() => kit.toast('Stopped syncing')).catch(() => {}).finally(loadSync);
      }
    }

    // ---- dragging a file or folder onto a folder, a course or a crumb: pointer-driven (the window takes OS drops) ----
    let drag = null;
    function dragStart(e, it) {
      if (e.button !== 0) return;
      drag = { it, x: e.clientX, y: e.clientY, on: false, ghost: null, over: null };
      document.addEventListener('pointermove', dragMove);
      document.addEventListener('pointerup', dragEnd, { once: true });
    }
    function dragMove(e) {
      if (!drag) return;
      if (!drag.on) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
        drag.on = true;
        drag.ghost = h('div', { class: 'drag-ghost' }, icon(drag.it.table === 'folders' ? 'folder' : 'file'), h('span', { class: 'ellipsis', text: 'Move ' + drag.it.row.name }));
        document.body.append(drag.ghost);
        document.body.classList.add('dragging');
      }
      drag.ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY - 6}px)`;
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop]');
      const ok = t && !(drag.it.table === 'folders' && t.dataset.drop === drag.it.row.id);
      if (drag.over !== (ok ? t : null)) { drag.over?.classList.remove('drop-on'); drag.over = ok ? t : null; drag.over?.classList.add('drop-on'); }
    }
    function dragEnd() {
      document.removeEventListener('pointermove', dragMove);
      const d = drag;
      drag = null;
      if (!d?.on) return;
      d.ghost.remove();
      document.body.classList.remove('dragging');
      d.over?.classList.remove('drop-on');
      if (!d.over) return;
      // A click right after a drag must not open what was dropped.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, true), 50);
      const t = d.over.dataset;
      if (t.dropCourseCard) setCourse(d.it.row, t.dropCourseCard);
      else moveInto(d.it, t.drop, t.dropCourse || course);
    }

    // ---- drawing ----
    function paintUsage() {
      if (!usage) { usageEl.replaceChildren(); return; }
      const used = usage.used ?? usage.used_bytes, total = usage.total ?? usage.total_bytes ?? usage.quota;
      const frac = total ? used / total : 0;
      swap(usageEl, h('small', { class: 'muted tnum', text: total ? `${size(used)} of ${size(total)}` : size(used) }), total ? kit.meter(frac, { cls: frac > 0.92 ? 'warn thin' : 'thin' }) : null);
      usageEl.dataset.tip = usage.free != null ? `${size(usage.free)} free on the server` : '';
    }
    function paintCrumbs() {
      const parts = [h('button', { class: `crumb ${!folder && !course ? 'on' : ''}`, 'data-drop': '', onclick: () => go('', '') }, icon('drive'), 'Drive')];
      if (course) parts.push(h('span', { class: 'faint', text: '/' }), h('span', { class: 'faint', text: 'Courses' }));
      for (const p of drive.path || []) {
        parts.push(h('span', { class: 'faint', text: '/' }), h('button', { class: 'crumb', 'data-drop': p.course ? '' : p.id, 'data-drop-course': p.course ? p.id : null, onclick: () => (p.course ? go('', p.id) : go(p.id, course)) }, p.name));
      }
      swap(crumbs, parts);
    }

    function syncCard(p) {
      const busy = !!syncCommands[p.id];
      const color = p.state === 'error' ? 'var(--accent)' : p.state === 'paused' ? 'var(--gold)' : p.state === 'syncing' ? 'var(--teal)' : 'var(--border)';
      const reasonText = { mass_delete: 'Review deleted files', root_unreadable: 'Folder unreadable', drive_folder_missing: 'Drive folder missing', user: 'Paused by you' };
      const stateText = p.state === 'paused' ? 'PAUSED' + (p.reason ? ' · ' + (reasonText[p.reason] || p.reason) : '') : (p.state || 'idle').toUpperCase();
      return h('div', { class: 'card stripe sync-card', style: { '--c': color } },
        h('div', { class: 'row' },
          h('div', { class: 'col grow' },
            h('div', { class: 'row' }, icon('folder-open', 'muted'), h('span', { class: 'ellipsis', 'data-tip': p.local, text: p.local }), h('span', { class: 'faint', text: '⇄' }), h('span', { class: 'ellipsis muted', 'data-tip': p.folder_path || 'Drive', text: 'Drive / ' + (p.folder_path || 'Folder').replace(/^Drive\s*\/\s*/i, '') })),
            h('small', { class: 'row' }, h('b', { style: { color, fontWeight: 700, letterSpacing: '.06em' }, text: stateText }), h('span', { class: 'muted', text: p.last_sync ? 'Last synced ' + syncTime(p.last_sync) : 'Not synced yet' }), p.pending ? h('span', { class: 'overdue', text: `· ${p.pending} pending` }) : null)),
          kit.btn('Sync now', () => syncCommand(p.id, 'now'), { compact: true, icon: 'sync', disabled: busy || p.state === 'paused' || p.state === 'syncing' }),
          kit.btn(p.state === 'paused' ? 'Resume' : 'Pause', () => syncCommand(p.id, p.state === 'paused' ? 'resume' : 'pause'), { compact: true, icon: p.state === 'paused' ? 'play' : 'pause', disabled: busy || p.reason === 'mass_delete' }),
          kit.btn('', () => revealPair(p.id), { compact: true, icon: 'folder-open', title: 'Show in File Explorer' }),
          kit.btn('', async () => {
            if (await kit.confirm(`Stop syncing ${p.folder_path || 'folder'}?`, 'Syncing will stop. All files will stay on this PC and on Drive.', 'Stop syncing', { danger: true })) {
              api.del('/api/syncfolders/' + p.id, { readOnly: true }).then(() => { kit.toast('Stopped syncing'); loadSync(); }).catch(() => {});
            }
          }, { compact: true, kind: 'danger', icon: 'trash', title: 'Stop syncing' })),
        p.state === 'paused' && (p.reason === 'root_unreadable' || p.reason === 'drive_folder_missing')
          ? h('div', { class: 'sync-alert', text: p.reason === 'root_unreadable' ? 'This folder on your PC cannot be found or read. Check that the folder exists and permissions allow access.' : 'The paired Drive folder is missing on the server.' }) : null,
        p.state === 'paused' && p.reason === 'mass_delete' ? h('div', { class: 'sync-alert' },
          h('span', { text: p.delete_count > 0 ? `${p.delete_count} files were deleted from ${p.delete_side}. Delete them on the other side too?` : `Folders were deleted from ${p.delete_side}. Delete them on the other side too?` }),
          syncCommands[p.id] === 'waiting' ? h('small', { class: 'muted', text: 'Waiting for the current sync to finish…' }) : null,
          h('div', { class: 'row' }, kit.btn('Delete them', () => syncCommand(p.id, 'confirm'), { kind: 'danger', compact: true, disabled: busy }), kit.btn('Put them back', () => syncCommand(p.id, 'keep'), { kind: 'primary', compact: true, disabled: busy }))) : null,
        p.errors?.length ? h('div', { class: 'stack8' },
          kit.btn(`${expandedErrors[p.id] ? 'Hide' : 'Show'} ${U.plural(p.errors.length, 'error')}`, () => { expandedErrors[p.id] = !expandedErrors[p.id]; render(); }, { kind: 'subtle', compact: true, icon: expandedErrors[p.id] ? 'up' : 'down', cls: 'self-start' }),
          expandedErrors[p.id] ? p.errors.map((er) => h('div', { class: 'sync-err' }, h('span', { class: 'ellipsis', text: er.path }), h('small', { class: 'overdue', text: er.error }))) : null) : null);
    }

    function courseCard(c) {
      const lc = localCopyFor(c.id);
      const st = copyStatus(lc);
      const col = state.courses.find((x) => x.id === c.id)?.color || 'var(--teal)';
      const el = h('button', { class: 'card hover stripe course-tile', style: { '--c': col }, 'data-drop': '', 'data-drop-course-card': c.id, onclick: () => go('', c.id),
        oncontextmenu: (e) => { e.preventDefault(); openMenu({ table: 'folders', row: c, courseCard: true }, e.clientX, e.clientY); } },
        h('b', { class: 'ellipsis', text: c.name }),
        h('small', { class: lc ? (st === 'Error' ? 'overdue' : st === 'Paused' ? 'gold' : 'ok-ink') : 'muted', 'data-tip': st === 'Error' ? copyError(lc) : null, text: U.plural(c.items || 0, 'file') + (lc ? '  ·  ' + st : '') }));
      return el;
    }

    function itemEl(it) {
      const f = it.row, isF = it.table === 'folders';
      const media = !isF && (isImage(f) || isVideo(f));
      const click = () => (isF ? go(f.id, course) : media ? preview(f) : openFile(f));
      const synced = isF && isFolderSynced(f.id);
      const shared = !!shares[f.id];
      const marks = [synced ? h('span', { class: 'mark-sync', 'data-tip': 'Synced to a folder on this PC' }, icon('sync')) : null, shared ? h('span', { class: 'mark-share', 'data-tip': 'Shared by link' }, icon('link')) : null];
      const more = kit.btn('', (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMenu(it, r.left, r.bottom + 4); }, { kind: 'subtle', compact: true, icon: 'more', title: 'More', cls: 'more' });
      const visual = isF ? h('span', { class: 'fi folder-ic' }, icon('folder')) : (isImage(f) || isVideo(f)) && thumb(f) ? h('img', { class: 'fi thumb', src: thumb(f), loading: 'lazy', alt: '', onerror: (e) => e.currentTarget.replaceWith(h('span', { class: 'fi' }, icon(fileIcon(f)))) }) : h('span', { class: 'fi' }, icon(fileIcon(f)));
      const meta = isF ? U.plural(f.items || 0, 'item') : size(f.size);
      let el;
      if (view === 'details') {
        el = h('div', { class: 'drow' }, h('span', { class: 'dname' }, visual, h('span', { class: 'ellipsis', text: f.name }), ...marks), h('span', { class: 'muted', text: f.updated_at ? U.shortDate(U.dayOf(f.updated_at)) + ' ' + U.clock(f.updated_at) : '' }), h('span', { class: 'muted', text: typeOf(f, isF) }), h('span', { class: 'muted tnum right', text: meta }), more);
      } else if (view === 'icons') {
        el = h('div', { class: 'dicon' }, visual, h('span', { class: 'dn', text: f.name }), h('span', { class: 'marks' }, ...marks), more);
      } else {
        el = h('div', { class: `dgal ${isF ? 'is-folder' : ''}` }, isF ? null : h('div', { class: 'gpic' }, visual), h('div', { class: 'row gcap' }, isF ? visual : null, h('span', { class: 'ellipsis grow', text: f.name }), ...marks, more));
      }
      el.classList.add('ditem');
      el.addEventListener('click', click);
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(it, e.clientX, e.clientY); });
      el.addEventListener('pointerdown', (e) => { if (!e.target.closest('.more')) dragStart(e, it); });
      if (isF) { el.dataset.drop = f.id; }
      return el;
    }

    function heading(key, label, cls = '') {
      return h('button', { class: `dh-btn ${sort.by === key ? 'on' : ''} ${cls}`, onclick: () => sortOn(key) }, label + (sort.by === key ? (sort.desc ? '  ↓' : '  ↑') : ''));
    }

    function render() {
      paintCrumbs();
      paintUsage();
      const list = items();
      const top = !course && !folder;
      const folders = list.filter((x) => x.table === 'folders'), files = list.filter((x) => x.table === 'files');
      swap(body,
        problem ? h('div', { class: 'sync-alert row' }, icon('warning'), h('span', { class: 'grow', text: problem }), kit.btn('', () => setProblem(''), { kind: 'subtle', compact: true, icon: 'close' })) : null,
        top && syncFolders.length ? h('div', { class: 'stack8' }, kit.section('Synced folders', U.plural(syncFolders.length, 'pair')), syncFolders.map(syncCard)) : null,
        drive.courses?.length ? h('div', {}, kit.section('Courses', String(drive.courses.length)), h('div', { class: 'course-tiles' }, drive.courses.map(courseCard))) : null,
        // Nothing here: nothing drawn (Upload and drop-anywhere stay in the header and the window).
        list.length ? h('div', { class: 'files-block' },
          kit.section(top ? 'Files' : (drive.path?.at(-1)?.name || 'Files'), list.length ? `${U.plural(folders.length, 'folder')} · ${U.plural(files.length, 'file')}` : ''),
          list.length && view === 'details' ? h('div', { class: 'drow dhead' }, heading('name', 'NAME'), heading('date', 'MODIFIED'), heading('type', 'TYPE'), heading('size', 'SIZE', 'right'), h('span')) : null,
          list.length && view !== 'details' ? h('div', { class: 'row sort-row' }, h('span', { class: 'label-inline faint', text: 'SORT' }), kit.seg([['name', 'Name'], ['date', 'Modified'], ['type', 'Type'], ['size', 'Size']].map(([v, l]) => ({ label: l + (sort.by === v ? (sort.desc ? ' ↓' : ' ↑') : ''), value: v })), sort.by, sortOn)) : null,
          list.length
            ? h('div', { class: `dlist v-${view} ${first ? 'stagger' : ''}` },
              view === 'details' ? list.map(itemEl) : [folders.length ? h('div', { class: `dgrid v-${view}` }, folders.map(itemEl)) : null, files.length ? h('div', { class: `dgrid v-${view}` }, files.map(itemEl)) : null])
            : null) : null,
        list.length ? h('small', { class: 'faint drive-tip', text: 'Click a picture or video to preview it, anything else opens in its app. Edits you save there are uploaded again by themselves.' }) : null);
      first = false;
    }

    // Files dropped from Explorer land in the folder on screen.
    ctx.dropHandler = { label: 'Drop to upload here', fn: (paths) => upload(paths) };
    load();
    loadUsage();
    loadSync();
    api.get('/api/drive/info', { quiet: true }).then((d) => { info = d; render(); }).catch(() => {});
    if (arg?.upload) upload(arg.upload);
    // Real time while you look: the list every few seconds, sync state every 3 s, the disk every minute.
    const t1 = setInterval(() => { if (document.visibilityState === 'visible') loadSync(); }, 3000);
    const t2 = setInterval(() => { if (document.visibilityState === 'visible' && !drag) load(); }, 5000);
    const t3 = setInterval(() => { if (document.visibilityState === 'visible') loadUsage(); }, 60000);
    return {
      update(w) { if (w === 'data') { load(); loadSync(); } else if (w === 'go') go('', ''); },
      unmount() { clearInterval(t1); clearInterval(t2); clearInterval(t3); dragEnd(); },
    };
  },
};
