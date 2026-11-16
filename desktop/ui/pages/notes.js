// Notes: courses are folders (REDESIGN §5 Notes; NotesPage.qml). Folders on the left, a masonry grid of cards tinted
// with the course colour on the right, a "Take a note" bar and search.
import { h, icon, swap } from '../dom.js';

export default {
  mount(root, ctx, arg) {
    const { api, state, U, kit } = ctx;
    let sel = arg?.course || sessionStorage.getItem('hg.notesSel') || 'all'; // "all" | "inbox" | "pinned" | course id
    let notes = [];
    let query = '';
    let first = true;

    const searchBox = kit.search({ placeholder: 'Search notes', oninput: (v) => { query = v; renderGrid(); } });
    searchBox.style.width = '280px';
    const ctxLine = h('span', { class: 'ctx' });
    const head = ctx.head({ title: 'Notes', acts: [searchBox, kit.btn('Note', () => newNote(), { kind: 'primary', icon: 'plus', kbd: 'N' })] });
    head.insertBefore(ctxLine, head.querySelector('.acts'));
    const folders = h('nav', { class: 'folders' });
    const take = h('button', { class: 'take', onclick: () => newNote() });
    const courseLine = h('div', { class: 'course-line' });
    const grid = h('div', { class: 'masonry' });
    const main = h('div', { class: 'notes-main' }, courseLine, take, grid);
    root.append(head, h('div', { class: 'page flush' }, h('div', { class: 'notes-split' }, folders, h('div', { class: 'notes-scroll' }, main))));

    const course = () => state.courses.find((c) => c.id === sel) || null;
    const today = () => state.now?.now?.date || U.dayOf(state.clock);
    function newNote() {
      const args = { date: today() };
      if (course()) args.course = course().id;
      ctx.newNote(args);
    }
    function select(v) { sel = v; sessionStorage.setItem('hg.notesSel', v); first = true; renderFolders(); renderGrid(); }

    function folderRow(value, label, { color, glyph, count, sub } = {}) {
      return h('button', { class: `folder ${sel === value ? 'on' : ''}`, onclick: () => select(value) },
        glyph ? icon(glyph) : h('i', { class: 'swatch', style: { '--c': color } }),
        h('span', { class: 'col grow' }, h('span', { class: 'ellipsis', text: label }), sub ? h('small', { class: 'faint ellipsis', text: sub }) : null),
        h('span', { class: 'faint tnum', text: String(count) }));
    }
    function renderFolders() {
      const count = (f) => notes.filter(f).length;
      swap(folders,
        folderRow('all', 'All notes', { glyph: 'note', count: notes.length }),
        folderRow('pinned', 'Pinned', { glyph: 'pin', count: count((n) => n.pinned) }),
        folderRow('inbox', 'No course', { glyph: 'courses', count: count((n) => !n.course_id) }),
        h('div', { class: 'group', text: 'COURSES' }),
        state.courses.map((c) => folderRow(c.id, c.name, { color: c.color, count: count((n) => n.course_id === c.id), sub: c.code || '' })),
        kit.btn('Course', () => ctx.editCourse(null), { kind: 'subtle', icon: 'plus', compact: true, cls: 'folder-add' }));
    }

    const shown = () => {
      const q = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      return notes
        .filter((n) => (sel === 'all' ? true : sel === 'inbox' ? !n.course_id : sel === 'pinned' ? n.pinned : n.course_id === sel))
        .filter((n) => !q.length || q.every((w) => ((n.title || '') + '\n' + U.plain(n.body)).toLowerCase().includes(w)))
        .sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at));
    };

    // Masonry: each card goes to the currently shortest column (by an estimate of its height).
    const estimate = (n) => 70 + (n.title ? 24 : 0) + Math.min(10, Math.ceil((n.body || '').length / 34) + (n.body || '').split('\n').length - 1) * 20;
    function card(n) {
      const c = ctx.courseById(n.course_id);
      const body = U.plain(n.body).trim();
      return h('button', { class: `card hover mcard ${c ? 'tinted' : ''}`, style: c ? { '--c': c.color } : null, onclick: () => ctx.openNote(n), 'data-id': n.id },
        n.title || n.pinned ? h('div', { class: 'row' }, h('b', { class: 'grow', text: n.title || '' }), n.pinned ? icon('pin', 'pin') : null) : null,
        body ? h('p', { text: body.length > 600 ? body.slice(0, 600) + '…' : body }) : null,
        h('small', { class: 'row' }, c && sel !== n.course_id ? h('em', { class: 'ellipsis', text: c.name }) : null,
          h('span', { class: 'faint', text: n.session_date ? U.shortDate(n.session_date) : U.ago(n.updated_at, state.clock) })));
    }
    function renderGrid() {
      const c = course();
      ctxLine.textContent = sel === 'all' ? 'Every note' : sel === 'inbox' ? 'Notes without a course' : sel === 'pinned' ? 'Pinned notes show in every session of their course' : c ? c.name : '';
      take.replaceChildren(h('span', { class: 'grow', text: c ? `Take a note for ${c.name}…` : 'Take a note…' }), icon('note'));
      swap(courseLine, c ? [h('span', { class: 'muted', text: [c.name, c.code, c.location, U.lead(c.teacher)].filter(Boolean).join('  ·  ') }), h('button', { class: 'link', onclick: () => ctx.editCourse(c), text: 'Edit course' }), h('button', { class: 'link', onclick: () => ctx.go('drive', { course: c.id }), text: 'Files' })] : null);
      courseLine.hidden = !c;
      const list = shown();
      const width = grid.clientWidth || main.clientWidth || 800;
      const cols = Math.max(1, Math.floor((width + 12) / (280 + 12)));
      const out = Array.from({ length: cols }, () => []), heights = new Array(cols).fill(0);
      for (const n of list) {
        let k = 0;
        for (let i = 1; i < cols; i++) if (heights[i] < heights[k]) k = i;
        out[k].push(n);
        heights[k] += estimate(n) + 12;
      }
      grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      swap(grid, list.length
        ? out.map((col) => h('div', { class: `mcol ${first ? 'stagger' : ''}` }, col.map(card)))
        : h('div', { class: 'empty notes-empty' }, h('h2', { text: query ? 'No notes match' : 'Nothing here yet' }), h('p', { text: query ? 'Try other words.' : 'Notes you take will show up here.' })));
      first = false;
    }

    let lastKey = '';
    async function load() {
      const d = await api.get('/api/notes', { quiet: true }).catch(() => null);
      if (!d) return;
      const key = JSON.stringify(d.map((n) => [n.id, n.updated_at, n.pinned, n.course_id])) + state.courses.length;
      notes = d;
      if (key === lastKey) return;
      lastKey = key;
      renderFolders();
      renderGrid();
    }
    load();
    const ro = new ResizeObserver(() => renderGrid());
    ro.observe(main);
    return {
      update(w) { if (w === 'data' || w === 'go') load(); },
      unmount() { ro.disconnect(); },
    };
  },
};
