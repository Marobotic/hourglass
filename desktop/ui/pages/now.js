// Now (round 5): the clock and the day at a glance, the live (or next) class with its progress, the notes for that
// class and what is coming this week; on the right the rest of today, running timers, next alarms and term
// attendance. An overview, not a dashboard (REDESIGN §5 Now; NowPage.qml).
import { h, icon, swap } from '../dom.js';
import { noteCard, todosOf, timeline } from './parts.js';

export default {
  mount(root, ctx) {
    const { api, state, U, kit } = ctx;
    let occ = [];         // this week's sessions (today to a week out), with the ones marked off
    let blocks = [];      // today's and tomorrow's sessions, merged, without the ones marked off
    let allNotes = state.notes || [];
    let loadedOnce = false;

    const clockEl = h('div', { class: 'now-clock tnum' });
    const dateEl = h('div', { class: 'now-date' });
    const stripEl = h('div', { class: 'daystrip' });
    const main = h('div', { class: 'col' });
    const rail = h('div', { class: 'rail' });
    const page = h('div', { class: 'page now-page' }, h('div', { class: 'cols' }, main, rail));
    const headCtx = h('span', { class: 'ctx' });
    const head = ctx.head({ title: 'Now' });
    head.insertBefore(headCtx, head.querySelector('.acts'));
    root.append(head, page);

    const today = () => U.dayOf(state.clock);
    // What is on and what starts in the next 12 hours. The first is the card, the rest "rest of today".
    const windowed = () => blocks.filter((b) => b.end_ms > state.clock && (b.date === today() || b.start_ms - state.clock <= 12 * 3600000));
    const isLive = (b) => !!(b && state.clock >= b.start_ms && state.clock < b.end_ms);

    // Notes dated today, then the class's notes: this session's, else the last session's (what to pick up from).
    function classNotes(block) {
      const out = allNotes.filter((n) => n.session_date === today() && (!block?.course_id || n.course_id === block.course_id));
      const cid = block?.course_id;
      if (cid) {
        const mine = allNotes.filter((n) => n.course_id === cid && n.session_date && n.session_date <= (block.session_date || block.date));
        const last = mine.reduce((m, n) => (n.session_date > m ? n.session_date : m), '');
        for (const n of mine) if (n.session_date === last && !out.includes(n)) out.push(n);
        for (const n of allNotes) if (n.course_id === cid && n.pinned && !out.includes(n)) out.push(n);
      } else for (const n of allNotes) if (n.session_date === today() && !out.includes(n)) out.push(n);
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
        api.get(`/api/schedule?from=${from}&to=${U.addDays(from, 7)}`, { quiet: true }).catch(() => null),
        api.get('/api/notes', { quiet: true }).catch(() => null),
      ]);
      if (r) { occ = r.occurrences; blocks = U.merge(occ.filter((o) => o.mark !== 'off' && o.date <= U.addDays(from, 1))); }
      if (notes) allNotes = notes;
      render();
    }

    // ---- the clock and the day strip ----
    function renderClock() {
      const p = U.clockParts(state.clock);
      const hm = h('span', { class: 'hm' }, ...[...p.hm].map((ch, i) => h('span', { class: clockEl.dataset.hm && clockEl.dataset.hm[i] !== ch ? 'roll' : '', text: ch })));
      clockEl.dataset.hm = p.hm;
      swap(clockEl, hm, h('small', { class: 'sec', text: p.s }), p.ap ? h('small', { class: 'ap', text: p.ap }) : null);
      const d = state.now?.now?.date || today();
      dateEl.textContent = `${U.weekdaysLong[U.isoWeekday(d) - 1]} ${U.dayNum(d)} ${U.monthName(d)}`;
    }
    // Today as one bar, 08:00 to 18:00 or wider: the sessions in their colours and a line at now.
    function dayStrip() {
      const list = occ.filter((o) => o.date === today() && o.mark !== 'off');
      if (!list.length) { stripEl.hidden = true; return; }
      stripEl.hidden = false;
      const startH = Math.min(8, ...list.map((o) => Math.floor(U.minutes(o.start_time) / 60)));
      const endH = Math.max(18, ...list.map((o) => Math.ceil(U.minutes(o.end_time) / 60)));
      const span = (endH - startH) * 60;
      const at = (m) => `${((m - startH * 60) / span) * 100}%`;
      stripEl.at = at;
      const mins = list.reduce((t, o) => t + U.minutes(o.end_time) - U.minutes(o.start_time), 0);
      const step = endH - startH > 12 ? 4 : 2;
      const hours = [];
      for (let hr = startH; hr <= endH; hr += step) hours.push(hr);
      swap(stripEl,
        h('div', { class: 'section', style: { marginBottom: '8px' } }, h('span', { text: 'Today' }), h('small', { text: `${U.plural(list.length, 'session')} · ${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} m` : ''} of class` })),
        h('div', { class: 'ds-bar' },
          list.map((o) => h('button', { class: `ds-blk ${o.end_ms <= state.clock ? 'past' : ''}`, style: { '--c': o.color || 'var(--muted)', left: at(U.minutes(o.start_time)), width: `calc(${at(U.minutes(o.end_time))} - ${at(U.minutes(o.start_time))})` }, title: `${o.title} · ${U.range(o.start_time, o.end_time)}`, onclick: () => ctx.openSession(o) })),
          h('i', { class: 'ds-now', style: { left: at(U.minutesOf(state.clock)) } })),
        h('div', { class: 'ds-hours' }, hours.map((hr) => h('span', { style: { left: at(hr * 60) }, text: U.t(U.pad(hr) + ':00').replace(':00 ', ' ') }))));
    }

    // ---- the live class (or the next one) ----
    function hero(block) {
      if (!block) {
        // Day off: one quiet card, never a big empty hero.
        const noCourses = !state.courses.length;
        const tomorrow = blocks.find((b) => b.date > today());
        return h('div', { class: 'card hero off' },
          h('h2', { text: noCourses ? 'Add your classes to get started' : 'Nothing else today' }),
          h('div', { class: 'meta', text: noCourses ? 'Hourglass opens the right notes when a class starts.' : tomorrow ? `Next: ${tomorrow.title} · ${U.weekdayOf(tomorrow.date)} ${U.t(tomorrow.start_time)}` : 'Nothing in the next 12 hours.' }),
          noCourses ? h('div', { class: 'acts' }, kit.btn('Add a course', () => ctx.editCourse(null), { kind: 'primary', icon: 'plus' }), kit.btn('Add an event', () => ctx.editEvent(null), { icon: 'calendar-plus' })) : null);
      }
      const live = isLive(block);
      const o = block.parts[0];
      const when = block.date === today() ? '' : ' · ' + U.shortDate(block.date);
      const meta = [U.range(block.start_time, block.end_time), block.location, U.lead(block.teacher)].filter(Boolean).join(' · ');
      const sessionNotes = block.course_id ? sessionNotesFor(block) : [];
      const marked = o.mark;
      const bar = live ? kit.progress() : null;
      if (bar) {
        const span = block.end_ms - block.start_ms;
        const ticks = Math.min(16, Math.round(span / 900000));
        bar.querySelector('.bar').append(...Array.from({ length: Math.max(0, ticks - 1) }, (_, i) => h('s', { style: { left: `${((i + 1) / ticks) * 100}%` } })));
        bar.append(h('div', { class: 'ends' }, h('span', { text: U.t(block.start_time) }), h('span', { class: 'nowlbl' }, h('span', { class: 'hero-now', text: U.clock(state.clock) }), ' now'), h('span', { text: U.t(block.end_time) })));
      }
      return h('section', { class: `hero ${live ? 'live' : 'next'}`, style: { '--c': block.color || 'var(--accent)' }, 'data-key': `${block.title}|${block.start_ms}` },
        h('div', { class: 'top' },
          live ? kit.chip('Live', { cls: 'live' }) : kit.chip('Next' + when, { cls: 'line' }),
          block.parts.map((p) => kit.chip(U.kindLabel(p.kind), { cls: 'line' })).slice(0, 3),
          marked ? kit.chip(U.markTag(marked), { cls: marked === 'attended' ? 'ok' : marked === 'absent' ? 'live' : '' }) : null,
          h('span', { class: 'left tnum' })),
        h('h2', { text: block.title }),
        h('div', { class: 'meta', text: meta }),
        block.parts.length > 1 ? h('div', { class: 'parts', text: U.partsText(block) }) : null,
        bar,
        h('div', { class: 'acts' },
          block.course_id ? kit.btn(sessionNotes.length ? 'Notes for this class' : 'Start notes for this class', () => ctx.sessionNote(o, sessionNotes), { kind: 'primary', icon: 'notes' }) : null,
          block.course_id && live && marked !== 'attended' ? kit.btn('Mark attended', (e) => { ctx.burstAt(e.currentTarget); api.action('mark_session', { event_id: o.event_id, date: o.session_date || o.date, status: 'attended' }).then(load); }, { icon: 'usercheck' }) : null,
          kit.btn('', (e) => sessionMenu(e.currentTarget, block), { icon: 'more', title: 'More' })));
    }
    function paintLeft(block) {
      const el = main.querySelector('.hero .left');
      if (!el || !block) return;
      if (isLive(block)) {
        const m = Math.max(0, Math.ceil((block.end_ms - state.clock) / 60000));
        const [num, unit] = m < 60 ? [String(m), 'min left'] : [U.left(m).replace(' left', ''), 'left'];
        if (el.dataset.v !== num) { el.replaceChildren(h('b', { class: el.dataset.v ? 'roll-up' : '', text: num }), unit); el.dataset.v = num; }
        main.querySelector('.hero .prog')?.set((state.clock - block.start_ms) / Math.max(1, block.end_ms - block.start_ms));
        const n = main.querySelector('.hero-now');
        if (n) n.textContent = U.clock(state.clock);
      } else el.textContent = 'Starts ' + U.relative(Math.ceil((block.start_ms - state.clock) / 60000));
    }

    async function sessionMenu(anchor, block) {
      const o = block.parts[0];
      const k = await kit.menuAt(anchor, block.title, [
        { key: 'open', label: 'Open session', icon: 'calendar' },
        { key: 'edit', label: 'Edit event', icon: 'edit' },
        block.course_id ? { key: 'course', label: 'Course notes', icon: 'folder' } : null,
        { key: 'note', label: 'Another note', icon: 'plus' },
        { separator: true },
        { key: 'off', label: 'No class today', icon: 'bell-off' },
        { key: 'skip', label: 'Skip this date', icon: 'close', danger: true },
      ].filter(Boolean));
      if (k === 'open') ctx.openSession(o);
      else if (k === 'edit') { const e = await api.get('/api/events/' + o.event_id).catch(() => null); if (e) ctx.editEvent(e); }
      else if (k === 'course') ctx.go('notes', { course: block.course_id });
      else if (k === 'note') { const day = o.session_date || o.date; const n = sessionNotesFor(block).length; ctx.newNote({ course: o.course_id || undefined, date: day, title: U.shortDate(day) + (n ? ` (${n + 1})` : '') }); }
      else if (k === 'off') api.action('mark_session', { event_id: o.event_id, date: o.session_date || o.date, status: 'off' }).then(load);
      else if (k === 'skip' && await kit.confirm(`Skip ${U.shortDate(o.date)}?`, 'Only this session is removed. The rest of the series stays.', 'Skip', { danger: true })) {
        api.action('remove_event', { event_id: o.event_id, scope: 'occurrence', date: o.session_date || o.date });
      }
    }

    // ---- notes for this class ----
    function notesBlock(block) {
      const list = classNotes(block);
      if (!list.length) return null;
      const c = ctx.courseById(block?.course_id);
      const title = block?.course_id ? (isLive(block) ? 'Notes for this class' : `Notes for ${block.title}`) : 'Notes for today';
      return h('div', {},
        h('div', { class: 'section' }, h('span', { text: title }), h('small', { text: c ? `${list.length} · ${c.name}` : String(list.length) }),
          c ? h('button', { class: 'link', text: `All ${c.name} notes`, onclick: () => ctx.go('notes', { course: c.id }) }) : null),
        h('div', { class: `note-grid ${loadedOnce ? '' : 'stagger'}` }, list.map((n) => noteCard(ctx, n, { today: today(), lines: 4, todoMax: 4, onclick: () => ctx.openNote(n) }))));
    }

    // ---- coming up this week: exams and events off the timetable, and the inbox's open to-dos ----
    function comingUp() {
      const from = U.addDays(today(), 1), to = U.addDays(today(), 7);
      const days = (d) => U.daysBetween(today(), d);
      const tiles = occ.filter((o) => o.date >= from && o.date <= to && o.mark !== 'off' && (o.kind === 'exam' || !o.course_id)).slice(0, 3)
        .map((o) => ({ ic: o.kind === 'exam' ? 'flag' : 'calendar', title: o.course_id && o.title !== o.course_name ? `${o.title}` : o.title, sub: [U.shortDate(o.date), U.t(o.start_time), o.location].filter(Boolean).join(' · '), when: days(o.date) === 1 ? 'tomorrow' : `in ${days(o.date)} days`, gold: true, onclick: () => ctx.openSession(o) }));
      const inbox = allNotes.filter((n) => !n.course_id).map((n) => ({ n, t: todosOf(U, n.body) })).filter((x) => x.t.some((t) => !t.done));
      if (inbox.length && tiles.length < 3) {
        const x = inbox.sort((a, b) => b.n.updated_at - a.n.updated_at)[0];
        const open = x.t.filter((t) => !t.done).length;
        tiles.push({ ic: 'checklist', title: `Inbox · ${x.n.title || 'To-dos'}`, sub: `${open} of ${x.t.length} to-dos left`, when: U.ago(x.n.updated_at, state.clock), onclick: () => ctx.openNote(x.n) });
      }
      if (!tiles.length) return null;
      return h('div', {}, kit.section('Coming up', 'this week'),
        h('div', { class: 'upcoming' }, tiles.map((t) => h('button', { class: 'card hover up', onclick: t.onclick },
          h('span', { class: 'ibox' }, icon(t.ic)), h('span', { class: 'grow' }, h('b', { class: 'ellipsis', text: t.title }), h('small', { class: 'ellipsis', text: t.sub })),
          h('span', { class: t.gold ? 'when gold' : 'when', text: t.when })))));
    }

    // ---- the rail ----
    function restOfToday(win) {
      const later = win.slice(1);
      if (!later.length) return null;
      const items = later.map((b, i) => ({
        time: U.t(b.start_time), color: b.color, title: b.title, next: i === 0,
        sub: [b.parts.map((p) => U.kindLabel(p.kind)).join(' + '), b.location, `until ${U.t(b.end_time)}`].filter(Boolean).join(' · '),
        chip: i === 0 ? h('span', { class: 'cd tnum' }, h('small', { text: 'NEXT' }), h('span', { class: 'cd-in', text: U.relative(Math.ceil((b.start_ms - state.clock) / 60000)) })) : null,
        onclick: () => ctx.openSession(b.parts[0]),
      }));
      const all = later.every((b) => b.date === today());
      return h('div', { class: 'card raised rail-card' }, kit.section(all ? 'Rest of today' : 'Coming up', `${later.length} more`), timeline(items));
    }
    // A timer: its ring drains with the time left.
    const ringSvg = (frac, ic) => {
      const C = 2 * Math.PI * 17;
      const el = h('span', { class: 'tring', html: `<svg viewBox="0 0 40 40"><circle class="tr" cx="20" cy="20" r="17"/><circle class="pr" cx="20" cy="20" r="17" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(2)}"/></svg>` }, h('span', { class: 'ic-wrap' }, icon(ic)));
      el.set = (f) => el.querySelector('.pr').setAttribute('stroke-dashoffset', (C * (1 - Math.max(0, Math.min(1, f)))).toFixed(2));
      return el;
    };
    const timerLeft = (t) => (t.state === 'running' ? (t.ends_at - state.clock) / 1000 : t.remaining_s || 0);
    function running() {
      const list = (state.now?.timers || []).filter((t) => t.state === 'running' || t.state === 'paused').slice(0, 3);
      if (!list.length) return null;
      return h('div', {}, kit.section('Running'), h('div', { class: 'stack8' }, list.map((t) => h('div', { class: `tile ${t.state}`, 'data-timer': t.id },
        ringSvg(timerLeft(t) / Math.max(1, t.duration_s || timerLeft(t)), t.state === 'paused' ? 'coffee' : 'pause'),
        h('button', { class: 'grow tile-main', onclick: () => ctx.go('timers') }, h('span', { class: 'big tnum timer-left', text: U.countdown(timerLeft(t)) }), h('small', { class: 'ellipsis', text: (t.label || 'Timer') + (t.state === 'paused' ? ' · paused' : '') })),
        t.state === 'paused' ? kit.btn('Resume', () => api.action('update_timer', { timer_id: t.id, action: 'resume' }).then(() => ctx.refresh()), { compact: true }) : null))));
    }
    function nextAlarms() {
      const list = (state.now?.alarms || []).slice(0, 3);
      if (!list.length) return null;
      return h('div', {}, kit.section('Next alarms'), h('div', { class: 'stack8' }, list.map((a) => {
        const lead = a.lead_course_id || a.lead_event_id;
        const day = U.dayOf(a.next_at);
        const dayWord = day === today() ? 'today' : day === U.addDays(today(), 1) ? 'tomorrow' : U.weekdayOf(day);
        return h('div', { class: 'tile' },
          h('span', { class: `bellbox ${lead ? 'lead' : ''}` }, icon('bell')),
          h('button', { class: 'grow tile-main', onclick: () => ctx.go('alarms') }, h('span', { class: 'big tnum', text: U.clock(a.next_at) }), h('small', { class: 'ellipsis', text: [a.label, dayWord].filter(Boolean).join(' · ') })),
          kit.btn('Skip', async () => {
            const r = await api.action('skip_alarm', { alarm_id: a.id, date: day }).catch(() => null);
            if (!r) return;
            kit.toast(`Skipped the ${U.clock(r.skipped_at)} ring`, { action: 'Undo', onAction: () => api.action('skip_alarm', { alarm_id: a.id, undo: true }).then(() => ctx.refresh()) });
            ctx.refresh();
          }, { icon: 'skip', compact: true, kind: 'ghost', title: `Skip only the ${dayWord} ring; the alarm stays on` }));
      })));
    }
    // Term attendance per course against the 75% line.
    function termBars() {
      const rows = state.courses.map((c) => ({ c, a: c.attendance?.attended || 0, x: c.attendance?.absent || 0 })).filter((r) => r.a + r.x > 0);
      if (!rows.length) return null;
      return h('div', { class: 'card raised rail-card' },
        h('div', { class: 'section' }, h('span', { text: 'Attendance' }), h('small', { text: 'term to date' }), h('button', { class: 'link', text: 'Open', onclick: () => ctx.go('attendance') })),
        h('div', { class: 'term' }, rows.map(({ c, a, x }) => {
          const p = a / (a + x);
          return h('button', { class: 'tb', style: { '--c': c.color }, onclick: () => ctx.go('attendance') },
            h('span', { class: 'row' }, h('i', { class: 'dot' }), h('span', { class: 'grow ellipsis', text: c.name }), h('b', { class: `tnum ${p < 0.75 ? 'ink' : ''}`, text: Math.round(p * 100) + '%' })),
            h('span', { class: 'tbar' }, h('i', { style: { width: `${p * 100}%` } }), h('s')));
        })));
    }

    let lastKey = '';
    function render() {
      renderClock();
      const win = windowed();
      const block = win[0] || null;
      const live = isLive(block);
      headCtx.textContent = block ? (live ? `${block.title} · live until ${U.t(block.end_time)}` : `Next: ${block.title} ${U.relative(Math.ceil((block.start_ms - state.clock) / 60000))}`) : U.longDate(today());
      // Ticks only update the moving parts; a real change redraws.
      const key = JSON.stringify([block?.title, block?.start_ms, live, win.length, allNotes.map((n) => n.id + n.updated_at), state.now?.alarms, (state.now?.timers || []).map((t) => t.id + t.state), state.courses.map((c) => [c.id, c.attendance]), block?.parts?.[0]?.mark, occ.length, U.hhmmOf(state.clock).slice(0, 4)]);
      if (key === lastKey) return tick(block);
      lastKey = key;
      dayStrip();
      swap(main,
        h('div', { class: 'now-top' }, h('div', { class: 'now-time' }, dateEl, clockEl), stripEl),
        hero(block),
        notesBlock(block),
        comingUp());
      swap(rail, restOfToday(win), running(), nextAlarms(), termBars());
      rail.hidden = !rail.children.length;
      page.querySelector('.cols').classList.toggle('one', rail.hidden);
      paintLeft(block);
      loadedOnce = true;
    }
    function tick(block) {
      paintLeft(block);
      for (const el of rail.querySelectorAll('[data-timer]')) {
        const t = (state.now?.timers || []).find((x) => x.id === el.dataset.timer);
        if (!t || t.state !== 'running') continue;
        el.querySelector('.timer-left').textContent = U.countdown(timerLeft(t));
        el.querySelector('.tring').set?.(timerLeft(t) / Math.max(1, t.duration_s || 1));
      }
      const cd = rail.querySelector('.cd-in'), next = windowed()[1];
      if (cd && next) cd.textContent = U.relative(Math.ceil((next.start_ms - state.clock) / 60000));
      const nowLine = stripEl.querySelector('.ds-now');
      if (nowLine && stripEl.at) nowLine.style.left = stripEl.at(U.minutesOf(state.clock));
    }

    load();
    let minute = U.hhmmOf(state.clock);
    return {
      noteNow,
      update(what) {
        if (what === 'tick') {
          render();
          // Every new minute, sessions may start or end: reload the day.
          const m = U.hhmmOf(state.clock);
          if (m !== minute) { minute = m; if (m.endsWith('0')) load(); }
        } else if (what === 'data' || what === 'go') { allNotes = state.notes || allNotes; load(); }
        else if (what === 'state') render();
      },
    };
  },
};
