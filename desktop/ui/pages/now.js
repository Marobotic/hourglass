// Now: what is on (or next), the notes that go with today, and what's coming. An overview, not a dashboard
// (REDESIGN §5 Now; NowPage.qml).
import { h, icon, swap } from '../dom.js';
import { noteCard } from './parts.js';

export default {
  mount(root, ctx) {
    const { api, state, U, kit } = ctx;
    let blocks = [];      // today's and tomorrow's sessions, merged, without the ones marked off
    let allNotes = [];
    let loadedOnce = false;

    const clockEl = h('div', { class: 'clock tnum' });
    const dateEl = h('div', { class: 'date' });
    const body = h('div', { class: 'page-col' });
    const page = h('div', { class: 'page' }, body);
    const headCtx = h('span', { class: 'ctx' });
    const head = ctx.head({ title: 'Now', acts: [kit.btn('Note', () => noteNow(), { icon: 'note', kbd: 'N', title: 'A note for the current session' }), kit.btn('', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })), { kind: 'subtle', icon: 'search', kbd: 'Ctrl K', title: 'Search and commands' })] });
    head.insertBefore(headCtx, head.querySelector('.acts'));
    root.append(head, page);

    const today = () => U.dayOf(state.clock);
    // Today only: what is on and what starts in the next 12 hours. The first is the card, the rest "coming up".
    const windowed = () => blocks.filter((b) => b.end_ms > state.clock && (b.date === today() || b.start_ms - state.clock <= 12 * 3600000));
    const isLive = (b) => !!(b && state.clock >= b.start_ms && state.clock < b.end_ms);

    // Notes dated today, then the class's notes: this session's, else the last session's (what to pick up from).
    function todayNotes(block) {
      const out = allNotes.filter((n) => n.session_date === today());
      const cid = block?.course_id;
      if (cid) {
        const mine = allNotes.filter((n) => n.course_id === cid && n.session_date && n.session_date <= (block.session_date || block.date));
        const last = mine.reduce((m, n) => (n.session_date > m ? n.session_date : m), '');
        for (const n of mine) if (n.session_date === last && !out.includes(n)) out.push(n);
        for (const n of allNotes) if (n.course_id === cid && n.pinned && !out.includes(n)) out.push(n);
      }
      return out.sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at)).slice(0, 6);
    }

    function sessionNotesFor(block) {
      const o = block.parts[0], day = o.session_date || o.date;
      return allNotes.filter((n) => n.course_id === o.course_id && n.session_date === day);
    }

    function noteNow() {
      const b = windowed()[0];
      if (b && b.course_id && isLive(b)) ctx.sessionNote(b.parts[0], sessionNotesFor(b));
      else {
        const f = state.now?.focus;
        if (f && f.course_id) ctx.sessionNote(f, state.now.notes?.session);
        else ctx.newNote({});
      }
    }

    async function load() {
      const from = today();
      const [r, notes] = await Promise.all([
        api.get(`/api/schedule?from=${from}&to=${U.addDays(from, 1)}`, { quiet: true }).catch(() => null),
        api.get('/api/notes', { quiet: true }).catch(() => null),
      ]);
      if (r) blocks = U.merge(r.occurrences.filter((o) => o.mark !== 'off'));
      if (notes) allNotes = notes;
      render();
    }

    function renderClock() {
      const p = U.clockParts(state.clock);
      const live = isLive(windowed()[0]);
      const hm = h('span', { class: 'hm' }, ...[...p.hm].map((ch, i) => h('span', { class: clockEl.dataset.hm && clockEl.dataset.hm[i] !== ch ? 'roll' : '', text: ch })));
      clockEl.dataset.hm = p.hm;
      clockEl.replaceChildren(hm, live || (state.now?.timers || []).some((t) => t.state === 'running') ? h('small', { class: 'sec', text: ':' + p.s }) : null, p.ap ? h('small', { class: 'ap', text: p.ap }) : null);
      dateEl.textContent = state.now ? U.longDate(state.now.now?.date || today()) : U.longDate(today());
    }

    function hero(block) {
      if (!block) {
        // Day off: one quiet card, never a big empty hero.
        const noCourses = !state.courses.length;
        const tomorrow = blocks.find((b) => b.date > today());
        return h('div', { class: 'card hero off' },
          h('div', { class: 'row1' }, kit.chip('Day off')),
          h('h2', { text: noCourses ? 'Add your classes to get started' : 'Nothing on today' }),
          h('div', { class: 'meta', text: noCourses ? 'Hourglass opens the right notes when a class starts.' : tomorrow ? `Next: ${tomorrow.title} · ${U.weekdayOf(tomorrow.date)} ${U.t(tomorrow.start_time)}` : 'Nothing in the next 12 hours.' }),
          noCourses ? h('div', { class: 'acts' }, kit.btn('Add a course', () => ctx.editCourse(null), { kind: 'primary', icon: 'plus' }), kit.btn('Add an event', () => ctx.editEvent(null), { icon: 'calendar-plus' })) : null);
      }
      const live = isLive(block);
      const o = block.parts[0];
      const when = block.date === today() ? '' : ' · ' + U.shortDate(block.date);
      const left = live ? U.left(Math.ceil((block.end_ms - state.clock) / 60000)) : 'Starts ' + U.relative(Math.ceil((block.start_ms - state.clock) / 60000));
      const meta = [U.range(block.start_time, block.end_time), block.location, U.lead(block.teacher)].filter(Boolean).join(' · ');
      const sessionNotes = block.course_id ? sessionNotesFor(block) : [];
      const marked = o.mark;
      const card = h('div', { class: `card hero stripe ${live ? 'live breathe' : ''}`, style: { '--c': block.color || 'var(--accent)' }, 'data-key': `${block.title}|${block.start_ms}` },
        h('div', { class: 'row1' },
          live ? kit.chip('● Live', { cls: 'live' }) : kit.chip('Next' + when),
          block.parts.map((p) => kit.chip(U.kindLabel(p.kind))).slice(0, 3),
          marked ? kit.chip(U.markTag(marked), { cls: marked === 'attended' ? 'ok' : '' }) : null,
          h('span', { class: `left ${live ? '' : 'muted'}`, text: left })),
        h('h2', { text: block.title }),
        h('div', { class: 'meta', text: meta }),
        block.parts.length > 1 ? h('div', { class: 'parts faint', text: U.partsText(block) }) : null,
        h('div', { class: 'acts' },
          block.course_id ? kit.btn(sessionNotes.length ? 'Notes for this class' : 'Start notes for this class', () => ctx.sessionNote(o, sessionNotes), { kind: 'primary', icon: 'note' }) : null,
          block.course_id && live && marked !== 'attended' ? kit.btn('Mark attended', (e) => { ctx.burstAt(e.currentTarget); api.action('mark_session', { event_id: o.event_id, date: o.session_date || o.date, status: 'attended' }).then(load); }, { icon: 'check' }) : null,
          kit.btn('', (e) => sessionMenu(e.currentTarget, block), { icon: 'more', title: 'More' })),
        live ? kit.meter((state.clock - block.start_ms) / Math.max(1, block.end_ms - block.start_ms), { cls: 'thin hero-bar', tint: block.color }) : null);
      return card;
    }

    async function sessionMenu(anchor, block) {
      const o = block.parts[0];
      const k = await kit.menuAt(anchor, block.title, [
        { key: 'open', label: 'Open session', icon: 'calendar' },
        { key: 'edit', label: 'Edit event', icon: 'edit' },
        block.course_id ? { key: 'course', label: 'Course notes', icon: 'courses' } : null,
        { separator: true },
        { key: 'off', label: 'No class today', icon: 'bell-off' },
        { key: 'skip', label: 'Skip this date', icon: 'close', danger: true },
      ].filter(Boolean));
      if (k === 'open') ctx.openSession(o);
      else if (k === 'edit') { const e = await api.get('/api/events/' + o.event_id).catch(() => null); if (e) ctx.editEvent(e); }
      else if (k === 'course') ctx.go('notes', { course: block.course_id });
      else if (k === 'off') api.action('mark_session', { event_id: o.event_id, date: o.session_date || o.date, status: 'off' }).then(load);
      else if (k === 'skip' && await kit.confirm(`Skip ${U.shortDate(o.date)}?`, 'Only this session is removed. The rest of the series stays.', 'Skip', { danger: true })) {
        api.action('remove_event', { event_id: o.event_id, scope: 'occurrence', date: o.session_date || o.date });
      }
    }

    function notesBlock(block) {
      const list = todayNotes(block);
      const canNew = !!block?.course_id;
      if (!list.length && !canNew) return null;
      const grid = h('div', { class: `note-grid ${loadedOnce ? 'settled' : ''} stagger` },
        list.map((n) => noteCard(ctx, n, { today: today(), onclick: () => ctx.openNote(n) })),
        canNew ? h('button', { class: 'newtile', onclick: () => ctx.sessionNote(block.parts[0], sessionNotesFor(block)) }, icon('plus'), list.length ? 'Another note' : 'New note for this class') : null);
      return h('div', {}, kit.section(block?.course_id && isLive(block) ? 'Notes for this session' : 'Notes for today', list.length ? String(list.length) : ''), grid);
    }

    function comingUp(later) {
      if (!later.length) return null;
      return h('div', {}, kit.section('Coming up', later.length > 1 ? `${later.length} more` : ''),
        h('div', { class: 'timeline' }, later.map((b) => h('button', { class: 'tl-row', onclick: () => ctx.openSession(b.parts[0]) },
          h('span', { class: 'tm tnum', text: U.t(b.start_time) }),
          h('i', { class: 'dot', style: { '--c': b.color } }),
          h('span', { class: 'ttl ellipsis', text: b.title }),
          h('span', { class: 'kind faint', text: b.parts.map((p) => U.kindLabel(p.kind)).join(' + ') }),
          h('span', { class: 'rm faint', text: b.location || '' })))));
    }

    function timeRow() {
      const alarm = state.now?.alarms?.[0];
      const timer = (state.now?.timers || []).find((t) => t.state === 'running') || state.now?.timers?.[0];
      if (!alarm && !timer) return null;
      const timerLeft = timer ? (timer.state === 'running' ? (timer.ends_at - state.clock) / 1000 : timer.remaining_s) : 0;
      return h('div', { class: 'mini-rows' },
        timer ? h('button', { class: 'card hover mini-time', onclick: () => ctx.go('timers') },
          icon('timer', timer.state === 'running' ? 'live' : ''), h('span', { class: 'big tnum timer-left', text: U.countdown(timerLeft) }), h('span', { class: 'lbl ellipsis', text: timer.label || 'Timer' }),
          timer.state !== 'running' ? kit.chip('Paused') : null) : null,
        alarm ? h('button', { class: 'card hover mini-time', onclick: () => ctx.go('alarms') },
          icon('bell'), h('span', { class: 'big tnum', text: U.clock(alarm.next_at) }),
          h('span', { class: 'lbl ellipsis', text: [alarm.label, U.dayOf(alarm.next_at) === today() ? '' : U.weekdayOf(U.dayOf(alarm.next_at))].filter(Boolean).join(' · ') })) : null);
    }

    let lastKey = '';
    function render() {
      renderClock();
      const win = windowed();
      const block = win[0] || null;
      const live = isLive(block);
      headCtx.textContent = block ? (live ? `${block.title} · until ${U.t(block.end_time)}` : `Next: ${block.title} ${U.relative(Math.ceil((block.start_ms - state.clock) / 60000))}`) : U.longDate(today());
      // Ticks only update the moving parts; a real change redraws.
      const key = JSON.stringify([block?.title, block?.start_ms, live, win.length, allNotes.map((n) => n.id + n.updated_at), state.now?.alarms, (state.now?.timers || []).map((t) => t.id + t.state), state.courses.length, block?.parts?.[0]?.mark]);
      if (key === lastKey) return tick(block);
      lastKey = key;
      swap(body,
        h('div', { class: 'now-top' }, dateEl, clockEl),
        hero(block),
        notesBlock(block),
        comingUp(win.slice(1)),
        timeRow());
      loadedOnce = true;
    }
    function tick(block) {
      if (block && isLive(block)) {
        body.querySelector('.hero .left').textContent = U.left(Math.ceil((block.end_ms - state.clock) / 60000));
        body.querySelector('.hero-bar')?.set((state.clock - block.start_ms) / Math.max(1, block.end_ms - block.start_ms));
      } else if (block) body.querySelector('.hero .left').textContent = 'Starts ' + U.relative(Math.ceil((block.start_ms - state.clock) / 60000));
      const timer = (state.now?.timers || []).find((t) => t.state === 'running');
      const tl = body.querySelector('.timer-left');
      if (timer && tl) tl.textContent = U.countdown((timer.ends_at - state.clock) / 1000);
    }

    load();
    let minute = U.hhmmOf(state.clock);
    return {
      update(what) {
        if (what === 'tick') {
          render();
          // Every new minute, sessions may start or end: reload the day.
          const m = U.hhmmOf(state.clock);
          if (m !== minute) { minute = m; if (m.endsWith('0')) load(); }
        } else if (what === 'data' || what === 'go') load();
      },
    };
  },
};
