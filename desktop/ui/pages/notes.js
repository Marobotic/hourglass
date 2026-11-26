// Notes: courses are folders (REDESIGN §5 Notes; NotesPage.qml). Round 5: the folders as a rail with counts and the
// search, then "Take a note", the class that is live now with today's notes, and the rest as a masonry of cards
// tinted by course (to-dos previewed with the real 0.3.4 boxes).
import { h, icon, swap } from '../dom.js';
import { noteCard } from './parts.js';

export default {
  mount(root, ctx, arg) {
    const { api, state, U, kit } = ctx;
    let sel = arg?.course || sessionStorage.getItem('hg.notesSel') || 'all'; // "all" | "inbox" | "pinned" | course id
    let notes = state.notes || [];
    let query = '';
    let first = true;

    const searchBox = kit.search({ placeholder: 'Search notes', oninput: (v) => { query = v; renderGrid(); } });
    const ctxLine = h('span', { class: 'ctx' });
    const head = ctx.head({ title: 'Notes', acts: [kit.btn('New note', () => newNote(), { kind: 'primary', icon: 'plus', kbd: 'N' })] });
    head.insertBefore(ctxLine, head.querySelector('.acts'));
    const folders = h('nav', { class: 'folders' });
    const take = h('div', { class: 'take' });
    const courseLine = h('div', { class: 'course-line' });
    const liveEl = h('div');
    const grid = h('div', { class: 'masonry' });
    const gridHead = h('div');
    const main = h('div', { class: 'notes-main' }, courseLine, take, liveEl, h('div', {}, gridHead, grid));
    root.append(head, h('div', { class: 'page flush' }, h('div', { class: 'notes-split' }, h('div', { class: 'folders-wrap' }, searchBox, folders), h('div', { class: 'notes-scroll' }, main))));

    const course = () => state.courses.find((c) => c.id === sel) || null;
    const today = () => state.now?.now?.date || U.dayOf(state.clock);
    // The class on now (its notes from today lead the page), when looking at all notes.
    const live = () => (state.now?.active?.state === 'live' && state.now.active.course_id ? state.now.active : null);
    function newNote(fields = {}) {
      const args = { date: today(), ...fields };
      if (course()) args.course = course().id;
      else if (sel === 'all' && live()) args.course = live().course_id;
      ctx.newNote(args);
    }
    function select(v) { sel = v; sessionStorage.setItem('hg.notesSel', v); first = true; renderFolders(); renderGrid(); }

    function folderRow(value, label, { color, glyph, count } = {}) {
      return h('button', { class: `folder ${sel === value ? 'on' : ''}`, style: color ? { '--c': color } : null, onclick: () => select(value) },
        glyph ? icon(glyph) : h('i', { class: 'swatch' }),
        h('span', { class: 'grow ellipsis', text: label }),
        h('span', { class: 'cnt tnum', text: String(count) }));
    }
    function renderFolders() {
      const count = (f) => notes.filter(f).length;
      swap(folders,
        folderRow('all', 'All notes', { glyph: 'notes', count: notes.length }),
        folderRow('inbox', 'Inbox', { glyph: 'drive', count: count((n) => !n.course_id) }),
        folderRow('pinned', 'Pinned', { glyph: 'pin', count: count((n) => n.pinned) }),
        h('div', { class: 'group', text: 'Courses' }),
        state.courses.map((c) => folderRow(c.id, c.name, { color: c.color, count: count((n) => n.course_id === c.id) })),
        kit.btn('Course', () => ctx.editCourse(null), { kind: 'subtle', icon: 'plus', compact: true, cls: 'folder-add' }));
    }

    const q = () => query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = () => notes
      .filter((n) => (sel === 'all' ? true : sel === 'inbox' ? !n.course_id : sel === 'pinned' ? n.pinned : n.course_id === sel))
      .filter((n) => !q().length || q().every((w) => ((n.title || '') + '\n' + U.plain(n.body)).toLowerCase().includes(w)))
      .sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at));

    // Masonry: each card goes to the currently shortest column (by an estimate of its height).
    const estimate = (n) => 70 + (n.title ? 24 : 0) + Math.min(6, Math.ceil((n.body || '').length / 40)) * 20;
    const card = (n) => noteCard(ctx, n, { today: today(), lines: 6, todoMax: 4, showCourse: sel !== n.course_id, onclick: () => ctx.openNote(n) });
    function renderGrid() {
      const c = course();
      const lv = sel === 'all' && !q().length ? live() : null;
      ctxLine.textContent = sel === 'all' ? `${U.plural(notes.length, 'note')} · ${U.plural(state.courses.length, 'course')}` : sel === 'inbox' ? 'Notes without a course' : sel === 'pinned' ? 'Pinned notes show in every session of their course' : c ? [c.code, c.location, U.lead(c.teacher)].filter(Boolean).join(' · ') : '';
      const forName = c ? c.name : lv ? lv.title : '';
      take.replaceChildren(
        h('button', { class: 'take-main', onclick: () => newNote() }, icon('edit'), h('span', { class: 'grow', text: forName ? `Take a note for ${forName}…` : 'Take a note…' })),
        h('button', { class: 'take-ic', title: 'A to-do list', onclick: () => newNote({ body: '- [ ] ' }) }, icon('checklist')));
      swap(courseLine, c ? [h('b', { text: c.name }), h('button', { class: 'link', onclick: () => ctx.editCourse(c), text: 'Edit course' }), h('button', { class: 'link', onclick: () => ctx.go('drive', { course: c.id }), text: 'Files' })] : null);
      courseLine.hidden = !c;
      let list = shown();
      // The class on now: today's notes for it come first, in their own band.
      const band = lv ? list.filter((n) => n.course_id === lv.course_id && n.session_date === today()) : [];
      swap(liveEl, band.length ? [h('div', { class: 'section' }, h('span', { text: `${lv.title} · live now` }), h('small', { text: `${U.plural(band.length, 'note')} from today` }), h('button', { class: 'link', text: 'Open the class', onclick: () => ctx.openSession(lv) })),
        h('div', { class: `band ${first ? 'stagger' : ''}` }, band.map(card))] : null);
      if (band.length) list = list.filter((n) => !band.includes(n));
      const label = q().length ? 'Found' : sel === 'all' ? (band.length ? 'Recent' : 'All notes') : sel === 'inbox' ? 'Inbox' : sel === 'pinned' ? 'Pinned' : c ? c.name : '';
      swap(gridHead, list.length && (band.length || q().length) ? kit.section(label, String(list.length)) : null);
      const width = grid.clientWidth || main.clientWidth || 800;
      const cols = Math.max(1, Math.floor((width + 16) / (300 + 16)));
      const out = Array.from({ length: cols }, () => []), heights = new Array(cols).fill(0);
      for (const n of list) {
        let k = 0;
        for (let i = 1; i < cols; i++) if (heights[i] < heights[k]) k = i;
        out[k].push(n);
        heights[k] += estimate(n) + 16;
      }
      grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      swap(grid, list.length
        ? out.map((col) => h('div', { class: `mcol ${first ? 'stagger' : ''}` }, col.map(card)))
        : band.length ? null : h('div', { class: 'empty notes-empty' }, h('h2', { text: query ? 'No notes match' : 'Nothing here yet' }), h('p', { text: query ? 'Try other words.' : 'Notes you take will show up here.' })));
      const bandEl = liveEl.querySelector('.band');
      // The live class's notes fill the row: as many equal columns as there are cards, up to the grid's own.
      if (bandEl) bandEl.style.setProperty('grid-template-columns', `repeat(${Math.max(1, Math.min(cols, bandEl.children.length))}, minmax(0, 1fr))`);
      first = false;
    }

    let lastKey = '';
    async function load() {
      const d = await api.get('/api/notes', { quiet: true }).catch(() => null);
      if (!d) return;
      const key = JSON.stringify(d.map((n) => [n.id, n.updated_at, n.pinned, n.course_id])) + state.courses.length + (live()?.course_id || '');
      notes = d;
      if (key === lastKey) return;
      lastKey = key;
      renderFolders();
      renderGrid();
    }
    if (notes.length) { renderFolders(); renderGrid(); }
    load();
    const ro = new ResizeObserver(() => renderGrid());
    ro.observe(main);
    return {
      update(w) { if (w === 'data' || w === 'go') load(); },
      unmount() { ro.disconnect(); },
    };
  },
};
