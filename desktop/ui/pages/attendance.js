// Attendance: every course with every session so far (AttendancePage.qml). ✓ attended (teal), ✗ absent (red),
// – off (muted), empty = not marked. Click a box to cycle it. The course cards sit side by side with their rate.
// The marks stay the original symbols (Maro, 2026-11-23), never coloured squares.
import { h, swap } from '../dom.js';

const NEXT = { '': 'attended', attended: 'absent', absent: 'off', off: 'none' };
const GLYPH = { attended: '✓', absent: '✗', off: '–', '': '' };
const TINT = { attended: 'var(--teal)', absent: 'var(--accent)', off: 'var(--muted)', '': 'var(--faint)' };

export default {
  mount(root, ctx) {
    const { api, state, U, kit } = ctx;
    let data = [];
    let last = '';
    let first = true;
    let popped = '';   // the box just marked here: it pops once
    const main = h('div', { class: 'col' });
    const headCtx = h('span', { class: 'ctx', text: 'Every session so far, per course' });
    const head = ctx.head({ title: 'Attendance' });
    head.insertBefore(headCtx, head.querySelector('.acts'));
    root.append(head, h('div', { class: 'page' }, h('div', { class: 'cols one' }, main)));
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
          if (!c[day]) c[day] = { date: day, mark: o.mark || '', event_id: o.event_id, kind: o.kind, start_time: o.start_time, end_time: o.end_time, future: o.start_ms > state.clock, live: o.start_ms <= state.clock && o.end_ms > state.clock };
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

    const mark = (course, date, status) => { popped = `${course.id}|${date}`; return api.action('mark_session', { course: course.id, date, status }).then(load); };
    const count = (list, m) => list.filter((s) => s.mark === m && (m || !s.future)).length;
    const rateOf = (yes, no) => (yes + no ? yes / (yes + no) : null);

    function card({ course, sessions: list }) {
      const past = list.filter((s) => !s.future).length;
      const yes = count(list, 'attended'), no = count(list, 'absent'), off = count(list, 'off'), open = count(list, '');
      const rate = rateOf(yes, no);
      const toCome = list.length - past;
      const firstOpen = list.find((s) => !s.mark && !s.future);
      return h('div', { class: 'card att-card', style: { '--c': course.color } },
        h('i', { class: 'edge' }),
        h('div', { class: 'row' }, h('b', { class: 'grow ellipsis att-name', text: course.name }),
          h('b', { class: `att-rate tnum ${rate == null ? 'faint' : 'teal-ink'}`, text: rate == null ? '—' : Math.round(rate * 100) + '%' })),
        h('div', { class: 'att-stats tnum' },
          h('span', { class: 'teal-ink', text: `✓ ${yes} attended` }), h('span', { class: no ? 'ink' : '', text: `✗ ${no} absent` }), h('span', { text: `– ${off} off` }),
          open ? h('span', { class: 'gold', text: `● ${open} to mark` }) : null, h('span', { class: 'faint', text: `of ${past} so far, ${toCome} to come` })),
        h('div', { class: 'att-grid' }, list.map((s) => {
          const k = `${course.id}|${s.date}`;
          return h('div', { class: `att-cell ${s.future && !s.mark ? 'future' : ''}` },
            h('button', { class: `att-box ${s.mark ? 'on' : ''} ${s === firstOpen ? 'next' : ''} ${popped === k ? 'pop' : ''}`, style: { '--c': TINT[s.mark] },
              'data-tip': U.longDate(s.date), text: GLYPH[s.mark], onclick: () => mark(course, s.date, NEXT[s.mark]) }),
            h('small', { text: U.shortDate(s.date).split(' ').slice(1).join(' ') }));
        })),
        open ? kit.btn(`Mark the ${open} unmarked as attended`, () => { for (const s of list) if (!s.mark && !s.future) mark(course, s.date, 'attended'); }, { kind: 'subtle', icon: 'check', compact: true, cls: 'self-start' }) : null);
    }

    function render() {
      const shown = data.filter((d) => d.sessions.length);
      if (!data.length) {
        swap(main, h('div', { class: 'empty' }, h('h2', { text: 'No courses yet' }), h('p', { text: 'Add a course with its weekly times and its sessions show up here to mark.' }), kit.btn('Add a course', () => ctx.editCourse(null), { kind: 'primary', icon: 'plus' })));
        return;
      }
      swap(main, h('div', { class: `att-grid-cards ${first ? 'stagger' : ''}` }, shown.map(card)));
      first = false;
      popped = '';
    }

    load();
    // Marks made on another page, device or by an AI show up while you look.
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 4000);
    return { update(w) { if (w === 'data' || w === 'go') load(); }, unmount() { clearInterval(timer); } };
  },
};
