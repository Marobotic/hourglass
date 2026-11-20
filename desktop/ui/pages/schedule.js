// Schedule: a day or week grid, or the month (SchedulePage.qml). Back-to-back sessions of one course are one block.
import { h, icon, swap } from '../dom.js';

const HOUR = 64;     // px per hour
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
    const modeSeg = kit.seg([{ label: 'Day', value: 'day' }, { label: 'Week', value: 'week' }, { label: 'Month', value: 'month' }], mode, (m) => { mode = m; localStorage.setItem('hg.scheduleMode', m); scrolled = false; load(); });
    const head = ctx.head({
      title: 'Schedule',
      mid: [kit.btn('', () => shift(-1), { icon: 'left', compact: true, title: 'Previous' }), kit.btn('Today', () => { anchor = today(); scrolled = false; load(); }, { compact: true }), kit.btn('', () => shift(1), { icon: 'right', compact: true, title: 'Next' }), titleEl],
      acts: [modeSeg, kit.btn('Attendance', () => ctx.go('attendance'), { icon: 'check-square', kind: 'subtle' }), kit.btn('Course', () => ctx.editCourse(null), { icon: 'plus' }), kit.btn('Event', () => ctx.editEvent(null), { kind: 'primary', icon: 'plus' })],
    });
    const body = h('div', { class: 'sched' });
    root.append(head, h('div', { class: 'page flush' }, body));

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
      titleEl.textContent = mode === 'day' ? U.longDate(anchor) + (anchor === today() ? ' · Today' : '')
        : mode === 'week' ? `${U.shortDate(from)} – ${U.shortDate(to)}`
          : `${U.monthName(anchor)} ${anchor.slice(0, 4)}`;
      const list = merged();
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
    function block(o, height) {
      const past = state.clock > o.end_ms;
      return h('button', { class: `blk ${past ? 'past' : ''} ${o.mark === 'off' ? 'off' : ''}`, style: { '--c': o.color, top: `${U.minutes(o.start_time) / 60 * HOUR + 1}px`, height: `${height - 2}px` }, onclick: () => ctx.openSession(o.parts[0]), title: `${o.title} · ${U.range(o.start_time, o.end_time)}${o.location ? ' · ' + o.location : ''}` },
        h('b', { text: o.title }),
        height > 40 ? h('span', { text: U.range(o.start_time, o.end_time) + (o.mark ? '  ' + U.markTag(o.mark) : '') }) : null,
        height > 62 && o.location ? h('span', { class: 'loc', text: o.location }) : null,
        height > 88 && o.teacher ? h('span', { class: 'teach', text: U.lead(o.teacher) }) : null,
        height > 130 && o.parts.length > 1 ? h('span', { class: 'parts', text: U.partsText(o) }) : null);
    }

    function grid(list, dates) {
      const hours = Array.from({ length: 24 }, (_, i) => i);
      const heads = h('div', { class: 'grid-head', style: { gridTemplateColumns: `${GUTTER}px repeat(${dates.length}, 1fr)` } }, h('span'),
        dates.map((d) => h('button', { class: `dh ${d === today() ? 'today' : ''}`, onclick: () => { if (mode !== 'day') { anchor = d; mode = 'day'; modeSeg.set('day'); scrolled = false; load(); } } },
          h('small', { text: U.weekdayOf(d).toUpperCase() }), h('b', { text: String(U.dayNum(d)) }))));
      const cols = dates.map((d) => {
        const col = h('div', { class: `gcol ${d === today() ? 'today' : ''}` },
          dayItems(list, d).map((o) => {
            const s = U.minutes(o.start_time), e = Math.max(U.minutes(o.end_time), s + 30);
            return block(o, (e - s) / 60 * HOUR);
          }),
          d === today() ? h('i', { class: 'nowline', style: { top: `${U.minutesOf(state.clock) / 60 * HOUR}px` } }) : null);
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
          if (line) line.style.top = `${U.minutesOf(state.clock) / 60 * HOUR}px`;
        }
      },
      unmount() { ro.disconnect(); },
    };
  },
};
