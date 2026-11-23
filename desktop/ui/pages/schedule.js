// Schedule: a day or week grid, or the month (SchedulePage.qml). Back-to-back sessions of one course are one block.
// Round 5 look: course-edged cards on the hour grid, today's column lit, the now line with its time, and (when there
// is room) the live or next session on the right: where, who, its alarm, its attendance mark and its notes.
import { h, icon, swap } from '../dom.js';
import { noteCard } from './parts.js';

const HOUR = 72;     // px per hour
const GUTTER = 72;

export default {
  mount(root, ctx, arg) {
    const { api, state, U, kit } = ctx;
    const today = () => state.now?.now?.date || U.dayOf(state.clock);
    let mode = localStorage.getItem('hg.scheduleMode') || 'week';
    let anchor = arg?.date || today();
    let occ = [];
    let scrolled = false;

    const range = () => {
      if (mode === 'day') return [anchor, anchor];
      if (mode === 'week') { const ws = U.weekStart(anchor); return [ws, U.addDays(ws, 6)]; }
      const first = anchor.slice(0, 8) + '01';
      const gs = U.weekStart(first);
      const p = first.split('-');
      const last = U.fmt(Date.UTC(+p[0], +p[1], 0));
      const weeks = Math.ceil((U.daysBetween(gs, last) + 1) / 7);
      return [gs, U.addDays(gs, weeks * 7 - 1)];
    };

    const titleEl = h('span', { class: 'ctx' });
    const modeSeg = kit.seg([{ label: 'Day', value: 'day' }, { label: 'Week', value: 'week' }, { label: 'Month', value: 'month' }], mode, (m) => { mode = m; localStorage.setItem('hg.scheduleMode', m); scrolled = false; load(); ctx.emit('nav'); });
    const head = ctx.head({
      title: 'Schedule',
      mid: [modeSeg, kit.btn('', () => shift(-1), { icon: 'left', kind: 'ghost', title: 'Previous' }), kit.btn('', () => shift(1), { icon: 'right', kind: 'ghost', title: 'Next' }), kit.btn('Today', () => { anchor = today(); scrolled = false; load(); }, { icon: 'now' }), kit.btn('Add', (e) => addMenu(e.currentTarget), { kind: 'primary', icon: 'plus', title: 'A new event or course' })],
    });
    head.insertBefore(titleEl, head.querySelector('.mid'));
    const body = h('div', { class: 'sched' });
    const rail = h('aside', { class: 'sched-rail' });
    root.append(head, h('div', { class: 'page flush sched-page' }, h('div', { class: 'sched-split' }, body, rail)));
    async function addMenu(anchor) {
      const k = await kit.menuAt(anchor, '', [{ key: 'event', label: 'Event', icon: 'calendar-plus' }, { key: 'course', label: 'Course', icon: 'folder' }], { width: 200 });
      if (k === 'event') ctx.editEvent(null);
      else if (k === 'course') ctx.editCourse(null);
    }

    function shift(n) {
      if (mode === 'day') anchor = U.addDays(anchor, n);
      else if (mode === 'week') anchor = U.addDays(U.weekStart(anchor), 7 * n);
      else anchor = U.fmt(Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7) - 1 + n, 1));
      load();
    }

    async function load() {
      const [from, to] = range();
      const d = await api.get(`/api/schedule?from=${from}&to=${to}`, { quiet: true }).catch(() => null);
      if (d) occ = d.occurrences;
      render();
    }

    const merged = () => U.merge(occ);
    const dayItems = (list, d) => list.filter((o) => o.date === d);

    function render() {
      const [from, to] = range();
      const list = merged();
      const on = list.filter((o) => o.mark !== 'off');
      const mins = on.reduce((t, o) => t + U.minutes(o.end_time) - U.minutes(o.start_time), 0);
      const sameMonth = from.slice(0, 7) === to.slice(0, 7);
      titleEl.textContent = mode === 'day' ? U.longDate(anchor) + (anchor === today() ? ' · Today' : '')
        : mode === 'week' ? `${U.dayNum(from)}${sameMonth ? '' : ' ' + U.monthName(from).slice(0, 3)} – ${U.dayNum(to)} ${sameMonth ? U.monthName(to) : U.monthName(to).slice(0, 3)} · ${U.plural(on.length, 'session')}${mins ? ` · ${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} m` : ''} of class` : ''}`
          : `${U.monthName(anchor)} ${anchor.slice(0, 4)}`;
      renderRail();
      const keep = body.querySelector('.grid-scroll')?.scrollTop;
      if (mode === 'month') swap(body, month(list, from, to));
      else if (mode === 'week' && body.clientWidth && body.clientWidth < 760) swap(body, agenda(list, from));
      else swap(body, grid(list, mode === 'day' ? [anchor] : Array.from({ length: 7 }, (_, i) => U.addDays(from, i))));
      const sc = body.querySelector('.grid-scroll');
      if (sc && scrolled && keep != null) sc.scrollTop = keep;
      if (!scrolled && sc && body.clientHeight) {
        scrolled = true;
        const first = list.length ? Math.min(...list.map((o) => U.minutes(o.start_time))) : 8 * 60;
        sc.scrollTop = Math.max(0, (Math.min(first, U.minutesOf(state.clock)) / 60 - 1) * HOUR);
      }
    }

    // A block's words, as many as fit.
    // ---- the rail: the live session, else the next one ----
    let alarms = [];
    const railSession = () => {
      const n = state.now;
      const o = n?.active?.state === 'live' ? n.active : n?.next || null;
      return o && o.event_id ? o : null;
    };
    function renderRail() {
      const o = railSession();
      rail.hidden = !o;
      if (!o) return rail.replaceChildren();
      const live = o.state === 'live' || (state.clock >= o.start_ms && state.clock < o.end_ms);
      const day = o.session_date || o.date;
      const c = ctx.courseById(o.course_id);
      const bar = live ? kit.progress() : null;
      if (bar) {
        bar.append(h('div', { class: 'ends' }, h('span', { text: U.t(o.start_time) }), h('span', { class: 'nowlbl', text: U.clock(state.clock) + ' now' }), h('span', { text: U.t(o.end_time) })));
        requestAnimationFrame(() => bar.set((state.clock - o.start_ms) / Math.max(1, o.end_ms - o.start_ms)));
      }
      const left = live ? Math.max(0, Math.ceil((o.end_ms - state.clock) / 60000)) : 0;
      const lead = alarms.find((a) => a.enabled && ((a.lead_event_id && a.lead_event_id === o.event_id) || (a.lead_course_id && a.lead_course_id === o.course_id)));
      const facts = [
        o.location ? ['place', o.location, c?.code || ''] : null,
        o.teacher ? ['person', U.lead(o.teacher), o.teacher.includes(',') ? o.teacher.split(',').slice(1).join(',').trim() : ''] : null,
        lead ? ['bell', `Alarm ${U.clock(lead.next_at)}`, `${lead.lead_minutes} min before · rings ${U.dayOf(lead.next_at) === today() ? 'today' : U.weekdayOf(U.dayOf(lead.next_at))}${lead.skipped_at ? ' · one ring skipped' : ''}`] : null,
      ].filter(Boolean);
      const notes = (state.notes || []).filter((n) => n.course_id && n.course_id === o.course_id && (n.session_date === day || n.pinned)).slice(0, 3);
      let mark = o.mark || '';
      const markSeg = o.course_id ? kit.seg([
        { label: '✓ Attended', value: 'attended', tint: 'var(--teal)' }, { label: '✗ Absent', value: 'absent', tint: 'var(--accent)' }, { label: '– Off', value: 'off', tint: 'var(--muted)' },
      ], mark, async (v) => {
        const status = v === mark ? 'none' : v;
        const r = await api.action('mark_session', { event_id: o.event_id, date: day, status }).catch(() => null);
        if (r) mark = status === 'none' ? '' : status;
        markSeg.set(mark);
        ctx.refresh();
      }, { cls: 'mark-seg' }) : null;
      swap(rail,
        h('section', { class: `hero ${live ? 'live' : 'next'} rail-hero`, style: { '--c': o.color || 'var(--accent)' } },
          h('div', { class: 'top' }, live ? kit.chip('Live', { cls: 'live' }) : kit.chip('Next', { cls: 'line' }), kit.chip(U.kindLabel(o.kind), { cls: 'line' }),
            h('span', { class: 'left tnum' }, live ? [h('b', { text: left < 60 ? String(left) : U.left(left).replace(' left', '') }), left < 60 ? 'min left' : 'left'] : 'Starts ' + U.relative(Math.ceil((o.start_ms - state.clock) / 60000)))),
          h('h2', { text: o.title }),
          h('div', { class: 'meta', text: `${U.shortDate(o.date)} · ${U.range(o.start_time, o.end_time)}` }),
          bar),
        facts.length ? h('div', { class: 'card raised facts' }, facts.map(([ic, t, sub]) => h('div', { class: 'fact' }, icon(ic), h('div', {}, h('b', { text: t }), sub ? h('small', { text: sub }) : null)))) : null,
        markSeg ? h('div', {}, kit.section('Attendance', 'this session'), markSeg) : null,
        h('div', {}, kit.section('Notes', notes.length ? String(notes.length) : ''),
          h('div', { class: 'stack8' }, notes.map((n) => noteCard(ctx, n, { today: today(), todoMax: 2, onclick: () => ctx.openNote(n) })),
            o.course_id ? kit.btn(notes.length ? 'Another note' : 'Start a note for this session', () => ctx.sessionNote(o, notes.filter((n) => n.session_date === day)), { kind: 'ghost', icon: 'plus', cls: 'self-start' }) : null)));
    }
    api.action('list_alarms', {}, { quiet: true }).then((d) => { alarms = Array.isArray(d) ? d : []; renderRail(); }).catch(() => {});

    // A session card on the grid: time, title, kind and room, as many lines as fit; live ones glow, past ones dim.
    function block(o, height) {
      const past = state.clock > o.end_ms;
      const live = state.clock >= o.start_ms && state.clock < o.end_ms;
      const kinds = o.parts.map((p) => U.kindLabel(p.kind)).join(' + ');
      return h('button', { class: `blk ${height < 100 ? 'short' : ''} ${height < 64 ? 'tiny' : ''} ${past ? 'past' : ''} ${live ? 'is-live' : ''} ${o.mark === 'off' ? 'off' : ''}`, style: { '--c': o.color, '--p': live ? `${((state.clock - o.start_ms) / (o.end_ms - o.start_ms)) * 100}%` : null, top: `${U.minutes(o.start_time) / 60 * HOUR + 2}px`, height: `${height - 4}px` }, onclick: () => ctx.openSession(o.parts[0]), title: `${o.title} · ${U.range(o.start_time, o.end_time)}${o.location ? ' · ' + o.location : ''}` },
        live ? h('i', { class: 'fill' }) : null,
        height > 40 ? h('span', { class: 'tm tnum' }, h('span', { class: 'tm-range', text: U.range(o.start_time, o.end_time) }), h('span', { class: 'tm-start', text: U.t(o.start_time) })) : null,
        h('b', { text: o.title }),
        height > 84 && (kinds || o.location) ? h('span', { class: 's' }, kinds ? h('span', { class: o.location ? 's-kind' : '', text: kinds }) : null, kinds && o.location ? h('span', { class: 's-kind', text: ' · ' }) : null, o.location ? h('span', { text: o.location }) : null) : null,
        height > 104 && o.mark ? h('span', { class: `mk ${o.mark}`, text: U.markTag(o.mark) }) : height > 104 && live ? h('span', { class: 's ink', text: U.left(Math.ceil((o.end_ms - state.clock) / 60000)) }) : null,
        height > 130 && !live && o.teacher ? h('span', { class: 's s-who', text: U.lead(o.teacher) }) : null);
    }

    function grid(list, dates) {
      const hours = Array.from({ length: 24 }, (_, i) => i);
      const heads = h('div', { class: 'grid-head', style: { gridTemplateColumns: `${GUTTER}px repeat(${dates.length}, 1fr)` } }, h('span'),
        dates.map((d) => h('button', { class: `dh ${d === today() ? 'today' : ''}`, onclick: () => { if (mode !== 'day') { anchor = d; mode = 'day'; modeSeg.set('day'); scrolled = false; load(); } } },
          h('b', { class: 'tnum', text: String(U.dayNum(d)) }), h('span', { text: d === today() ? 'TODAY' : U.weekdayOf(d).toUpperCase() }), h('small', { text: String(dayItems(list, d).filter((o) => o.mark !== 'off').length || '') }))));
      const cols = dates.map((d) => {
        const col = h('div', { class: `gcol ${d === today() ? 'today' : ''}` },
          dayItems(list, d).map((o) => {
            const s = U.minutes(o.start_time), e = Math.max(U.minutes(o.end_time), s + 30);
            return block(o, (e - s) / 60 * HOUR);
          }),
          d === today() ? h('i', { class: 'nowline', style: { top: `${U.minutesOf(state.clock) / 60 * HOUR}px` } }, h('span', { class: 'tnum', text: U.clock(state.clock) })) : null);
        // Double-click an empty hour: a new event there.
        col.addEventListener('dblclick', (e) => {
          if (e.target !== col) return;
          const hr = Math.floor(e.offsetY / HOUR);
          ctx.editEvent(null, { date: d, start: U.pad(hr) + ':00', end: U.pad(Math.min(23, hr + 1)) + ':00' });
        });
        return col;
      });
      const inner = h('div', { class: 'grid-inner', style: { gridTemplateColumns: `${GUTTER}px repeat(${dates.length}, 1fr)`, height: `${24 * HOUR}px` } },
        h('div', { class: 'gutter' }, hours.map((hr) => h('span', { style: { top: `${hr * HOUR}px` }, text: hr ? U.t(U.pad(hr) + ':00') : '' }))),
        cols,
        h('div', { class: 'hlines' }, hours.map((hr) => h('i', { style: { top: `${hr * HOUR}px` } }))));
      return h('div', { class: 'grid' }, heads, h('div', { class: 'grid-scroll' }, inner));
    }

    // Half a screen is too narrow for seven columns: the week as a list of days.
    function agenda(list, from) {
      return h('div', { class: 'page agenda' }, h('div', { class: 'page-col' },
        Array.from({ length: 7 }, (_, i) => U.addDays(from, i)).map((d) => {
          const items = dayItems(list, d);
          return h('div', {}, kit.section((d === today() ? 'Today · ' : '') + U.longDate(d), items.length ? '' : 'Free'),
            h('div', { class: 'stack8' }, items.map((o) => h('button', { class: 'card hover stripe agenda-item', style: { '--c': o.color }, onclick: () => ctx.openSession(o.parts[0]) },
              h('div', { class: 'row' }, h('b', { class: 'grow', text: U.range(o.start_time, o.end_time) }), h('b', { text: o.location || '' })),
              h('div', { class: 'ellipsis', style: { opacity: o.mark === 'off' ? 0.6 : 1 }, text: o.title + (o.mark ? '  ' + U.markTag(o.mark) : '') }),
              h('small', { class: 'muted ellipsis', text: [U.partsText(o), U.lead(o.teacher)].filter(Boolean).join('   ·   ') })))));
        })));
    }

    function month(list, from, to) {
      const days = U.daysBetween(from, to) + 1;
      const inMonth = (d) => d.slice(0, 7) === anchor.slice(0, 7);
      return h('div', { class: 'month' },
        h('div', { class: 'mhead' }, Array.from({ length: 7 }, (_, i) => h('span', { text: U.weekdayOf(U.addDays(from, i)).toUpperCase() }))),
        h('div', { class: 'mgrid', style: { gridTemplateRows: `repeat(${days / 7}, 1fr)` } },
          Array.from({ length: days }, (_, i) => {
            const d = U.addDays(from, i), items = dayItems(list, d);
            return h('button', { class: `mcell ${inMonth(d) ? '' : 'out'} ${d === today() ? 'today' : ''}`, onclick: () => { anchor = d; mode = 'week'; modeSeg.set('week'); scrolled = false; load(); } },
              h('b', { text: String(U.dayNum(d)) }),
              items.slice(0, 3).map((o) => h('span', { class: 'mitem', style: { '--c': o.color } }, h('i'), h('span', { class: 'ellipsis', text: U.t(o.start_time) + ' ' + (o.course_code || o.title) }))),
              items.length > 3 ? h('small', { class: 'muted', text: `+${items.length - 3} more` }) : null);
          })));
    }

    load();
    const ro = new ResizeObserver(() => { if (mode === 'week') render(); });
    ro.observe(body);
    let minute = U.hhmmOf(state.clock);
    return {
      update(what) {
        if (what === 'data' || what === 'go') load();
        if (what === 'tick') {
          const m = U.hhmmOf(state.clock);
          if (m === minute) return;
          minute = m;
          const line = body.querySelector('.nowline');
          if (line) { line.style.top = `${U.minutesOf(state.clock) / 60 * HOUR}px`; line.firstChild.textContent = U.clock(state.clock); }
          renderRail();
          if (m.endsWith('0')) render();
        }
      },
      unmount() { ro.disconnect(); },
    };
  },
};
