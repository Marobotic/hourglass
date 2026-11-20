// Attendance: every course with every session so far (AttendancePage.qml). ✓ attended, ✗ absent, – off,
// empty = not marked. Click a box to cycle it.
import { h, swap } from '../dom.js';

const NEXT = { '': 'attended', attended: 'absent', absent: 'off', off: 'none' };
const GLYPH = { attended: '✓', absent: '✗', off: '–', '': '' };

export default {
  mount(root, ctx) {
    const { api, state, U, kit } = ctx;
    let data = [];
    let last = '';
    let first = true;
    const body = h('div', { class: 'page-col' });
    root.append(ctx.head({ title: 'Attendance', ctx: 'Every session so far, per course', acts: [kit.btn('Schedule', () => ctx.go('schedule'), { icon: 'week', kind: 'subtle' })] }), h('div', { class: 'page' }, body));
    const today = () => U.dayOf(state.clock);

    async function load() {
      const evs = await api.get('/api/events', { quiet: true }).catch(() => null);
      if (!evs) return;
      const mine = evs.filter((e) => e.course_id && !e.deleted);
      const starts = mine.map((e) => e.start_date).sort();
      let next = [];
      if (starts.length) {
        // To the end of term (the last "until"), at most 6 months out.
        const ends = mine.map((e) => (e.repeat?.until ? e.repeat.until : e.start_date)).sort();
        const to = [ends[ends.length - 1], U.addDays(today(), 183)].sort()[0];
        const r = await api.get(`/api/schedule?from=${starts[0]}&to=${to > today() ? to : today()}`, { quiet: true }).catch(() => null);
        if (!r) return;
        const by = {};
        for (const o of r.occurrences) {
          if (!o.course_id) continue;
          const day = o.session_date || o.date;
          const c = by[o.course_id] || (by[o.course_id] = {});
          if (!c[day]) c[day] = { date: day, mark: o.mark || '', event_id: o.event_id, future: o.start_ms > state.clock };
        }
        next = state.courses.map((c) => ({ course: c, sessions: Object.values(by[c.id] || {}).sort((a, b) => (a.date < b.date ? -1 : 1)) }));
      }
      // Only redraw when something changed (it is re-read every few seconds).
      const key = JSON.stringify(next);
      if (key === last) return;
      last = key;
      data = next;
      render();
    }

    const mark = (course, date, status) => api.action('mark_session', { course: course.id, date, status });
    const count = (list, m) => list.filter((s) => s.mark === m && (m || !s.future)).length;

    function legend() {
      const key = (box, tint, label) => h('span', { class: 'key' }, h('i', { class: `att-box sm ${box ? 'on' : ''}`, style: { '--c': tint }, text: box }), label);
      return h('div', { class: 'legend' }, key('✓', 'var(--teal)', 'attended'), key('✗', 'var(--accent-ink)', 'absent'), key('–', 'var(--muted)', 'off (no class)'), key('', 'var(--faint)', 'not marked: click to mark'));
    }

    function card({ course, sessions: list }) {
      const past = list.filter((s) => !s.future).length;
      const yes = count(list, 'attended'), no = count(list, 'absent'), off = count(list, 'off'), open = count(list, '');
      const rate = yes + no ? yes / (yes + no) : null;
      return h('div', { class: 'card stripe att-card', style: { '--c': course.color } },
        h('div', { class: 'row' }, h('b', { class: 'grow ellipsis att-name', text: course.name }),
          h('b', { class: 'att-rate', style: { color: rate == null ? 'var(--faint)' : rate < 0.75 ? 'var(--orange)' : 'var(--teal)' }, text: rate == null ? '—' : Math.round(rate * 100) + '%' })),
        rate != null ? kit.meter(rate, { cls: rate < 0.75 ? 'warn' : '', tint: 'var(--teal)' }) : null,
        h('small', { class: 'muted', text: `✓ ${yes} attended   ✗ ${no} absent   – ${off} off${open ? `   · ${open} not marked` : ''}   of ${past} so far, ${list.length - past} to come` }),
        h('div', { class: 'att-grid' }, list.map((s) => h('div', { class: `att-cell ${s.future && !s.mark ? 'future' : ''}` },
          h('button', { class: `att-box ${s.mark ? 'on' : ''}`, style: { '--c': s.mark === 'attended' ? 'var(--teal)' : s.mark === 'absent' ? 'var(--accent-ink)' : s.mark === 'off' ? 'var(--muted)' : 'var(--faint)' },
            'data-tip': U.longDate(s.date), text: GLYPH[s.mark], onclick: () => mark(course, s.date, NEXT[s.mark]) }),
          h('small', { text: U.shortDate(s.date).split(' ').slice(1).join(' ') })))),
        open ? kit.btn(`Mark the ${open} unmarked as attended`, () => { for (const s of list) if (!s.mark && !s.future) mark(course, s.date, 'attended'); }, { kind: 'subtle', icon: 'check', compact: true, cls: 'self-start' }) : null);
    }

    function render() {
      swap(body, legend(),
        data.length ? h('div', { class: `stack12 ${first ? 'stagger' : ''}` }, data.map(card))
          : h('div', { class: 'empty' }, h('h2', { text: 'No courses yet' }), h('p', { text: 'Add a course with its weekly times and its sessions show up here to mark.' }), kit.btn('Add a course', () => ctx.editCourse(null), { kind: 'primary', icon: 'plus' })));
      first = false;
    }

    load();
    // Marks made on another page, device or by an AI show up while you look.
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 4000);
    return { update(w) { if (w === 'data' || w === 'go') load(); }, unmount() { clearInterval(timer); } };
  },
};
