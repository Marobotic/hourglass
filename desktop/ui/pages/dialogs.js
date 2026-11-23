// Session, event and course sheets: ports of SessionDialog.qml, EventDialog.qml and CourseDialog.qml.
import { h, icon, swap } from '../dom.js';
import { noteCard } from './parts.js';

// ---- one occurrence: its notes, its mark, and actions for that date ----
export function session(ctx, occ) {
  const { api, U, kit } = ctx;
  const day = occ.session_date || occ.date;
  let mark = occ.mark || '';
  const markHint = h('small', { class: 'faint' });
  const markSeg = kit.seg([{ label: '✓ Attended', value: 'attended', tint: 'var(--teal)' }, { label: '✗ Absent', value: 'absent', tint: 'var(--accent)' }, { label: '– Off', value: 'off', tint: 'var(--muted)' }], mark, async (v) => {
    const status = v === mark ? 'none' : v;
    const r = await api.action('mark_session', { event_id: occ.event_id, date: day, status }).catch(() => null);
    if (r) mark = status === 'none' ? '' : status;
    markSeg.set(mark);
    paintHint();
  });
  const paintHint = () => { markHint.textContent = mark === 'off' ? 'No class this day: it is left out of Now.' : mark ? 'Click it again to clear.' : 'Mark it attended, absent, or off (no class that day).'; };
  paintHint();
  const notesBox = h('div', { class: 'stack8' });
  const teachers = (occ.teacher || '').split(',').map((t) => t.trim()).filter(Boolean);

  const loadNotes = async () => {
    if (!occ.course_id) return;
    const list = await api.action('get_notes', { course: occ.course_id, date: day }).catch(() => []);
    swap(notesBox,
      ...list.map((n) => noteCard(ctx, n, { showCourse: false, today: U.dayOf(ctx.state.clock), onclick: () => { s.close(); ctx.openNote(n); } })),
      list.length ? null : h('div', { class: 'quiet', text: 'No notes for this session yet.' }),
      kit.btn(list.length ? 'Add another note' : 'Start a note for this session', () => {
        s.close();
        ctx.newNote({ course: occ.course_id, date: day, title: U.shortDate(day) + (list.length ? ` (${list.length + 1})` : '') });
      }, { kind: 'primary', icon: 'note', cls: 'self-start' }));
  };

  const s = kit.sheet({
    title: occ.title,
    subtitle: [U.longDate(occ.date), U.range(occ.start_time, occ.end_time), occ.location].filter(Boolean).join('  ·  '),
    body: [
      h('div', { class: 'row' }, kit.chip(U.kindLabel(occ.kind), { tint: occ.color }), occ.course_code ? kit.chip(occ.course_code) : null),
      teachers.length ? h('div', { class: 'row muted' }, icon('person'), teachers.join(', ')) : null,
      kit.section('This day'),
      h('div', { class: 'row wrap' }, markSeg, markHint),
      occ.course_id ? kit.section('Notes for this session') : null,
      occ.course_id ? notesBox : null,
    ],
    footer: [
      kit.btn('Skip this date', async () => {
        if (await kit.confirm(`Skip ${U.shortDate(occ.date)}?`, 'Only this session is removed. The rest of the series stays.', 'Skip', { danger: true })) {
          api.action('remove_event', { event_id: occ.event_id, scope: 'occurrence', date: day }).then(() => s.close());
        }
      }, { kind: 'danger', icon: 'close' }),
      h('span', { class: 'grow' }),
      kit.btn('Edit event', async () => { const e = await api.get('/api/events/' + occ.event_id).catch(() => null); if (e) { s.close(); event(ctx, e); } }, { icon: 'edit' }),
      kit.btn('Close', () => s.close()),
    ],
  });
  loadNotes();
  const off = api.on('changed', loadNotes);
  const close = s.close;
  s.close = () => { off(); close(); };
  return s;
}

// ---- a one-off or recurring event ----
export function event(ctx, ev, defaults = {}) {
  const { api, U, kit, state } = ctx;
  const today = state.now?.now?.date || U.dayOf(state.clock);
  const v = {
    title: ev ? ev.title || '' : '',
    course: ev ? ev.course_id : (defaults.course || null),
    kind: ev ? ev.kind : (defaults.course ? 'lecture' : 'event'),
    date: ev ? ev.start_date : (defaults.date || today),
    start: U.t(ev ? ev.start_time : (defaults.start || '09:00')),
    end: U.t(ev ? ev.end_time : (defaults.end || '10:00')),
    loc: ev?.location || '',
    repeat: ev ? (ev.repeat ? ev.repeat.freq : 'none') : (defaults.repeatWeekly ? 'weekly' : 'none'),
    until: ev?.repeat?.until || '',
  };
  v.days = ev?.repeat?.days ? [...ev.repeat.days] : [U.isoWeekday(U.isDate(v.date) ? v.date : today)];
  v.forever = v.until === '';

  const titleF = kit.field({ value: v.title, oninput: (x) => { v.title = x; check(); } });
  const dateF = kit.field({ value: v.date, placeholder: 'YYYY-MM-DD', oninput: (x) => { v.date = x; check(); } });
  const startF = kit.field({ value: v.start, oninput: (x) => { v.start = x; check(); } });
  const endF = kit.field({ value: v.end, oninput: (x) => { v.end = x; check(); } });
  const locF = kit.field({ value: v.loc, placeholder: 'Optional', oninput: (x) => { v.loc = x; } });
  const untilF = kit.field({ value: v.until, placeholder: 'YYYY-MM-DD', oninput: (x) => { v.until = x; check(); } });
  const titleLabel = h('span');
  const dateLabel = h('span');
  const summary = h('small', { class: 'faint' });
  const dayT = kit.days(v.days, (d) => { v.days = d; check(); });
  const endsRow = h('div', { class: 'row' }, h('span', { class: 'label-inline', text: 'ENDS' }),
    kit.seg([{ label: 'Never', value: true }, { label: 'On a date', value: false }], v.forever, (x) => { v.forever = x; check(); if (!x) untilF.focus(); }), untilF);
  untilF.style.width = '150px';

  const valid = () => U.isDate(v.date) && U.isTime(v.start) && U.isTime(v.end) && U.minutes(v.end) > U.minutes(v.start)
    && (v.title.trim() !== '' || v.course !== null)
    && (v.repeat === 'none' || v.forever || (U.isDate(v.until) && v.until >= v.date))
    && (v.repeat !== 'weekly' || v.days.length > 0);
  let saveBtn;
  function check() {
    titleLabel.textContent = v.course ? 'Title (optional, defaults to the course)' : 'Title';
    titleF.placeholder = v.course ? 'e.g. Lab' : 'e.g. Dentist';
    dateLabel.textContent = v.repeat === 'none' ? 'Date' : 'First date';
    dateF.classList.toggle('invalid', !U.isDate(v.date));
    startF.classList.toggle('invalid', !U.isTime(v.start));
    endF.classList.toggle('invalid', !U.isTime(v.end) || (U.isTime(v.start) && U.minutes(v.end) <= U.minutes(v.start)));
    untilF.classList.toggle('invalid', !v.forever && (!U.isDate(v.until) || (U.isDate(v.date) && v.until < v.date)));
    dayT.hidden = v.repeat !== 'weekly';
    endsRow.hidden = v.repeat === 'none';
    untilF.hidden = v.forever;
    summary.textContent = v.repeat === 'none' || !U.isDate(v.date) ? '' : U.repeatText({ start_date: v.date, repeat: { freq: v.repeat, days: v.repeat === 'weekly' ? v.days : undefined, until: !v.forever && U.isDate(v.until) ? v.until : undefined } });
    if (saveBtn) saveBtn.disabled = !valid();
  }

  async function save() {
    if (!valid()) return;
    const args = {
      title: v.title.trim(), course: v.course, kind: v.kind, date: v.date,
      start: U.parseTime(v.start), end: U.parseTime(v.end), location: v.loc.trim() || undefined,
      repeat: v.repeat === 'none' ? null : { freq: v.repeat, days: v.repeat === 'weekly' ? v.days : undefined, until: v.forever ? undefined : v.until },
    };
    try {
      // Times are fixed in the event's zone; an old event without one takes the app's.
      if (ev) await api.action('update_event', { event_id: ev.id, ...args, ...(ev.tz ? {} : { tz: state.now?.now?.tz }) });
      else {
        if (!args.repeat) delete args.repeat;
        if (!args.course) delete args.course;
        await api.action('add_event', args);
      }
      s.close();
    } catch {}
  }

  saveBtn = kit.btn(ev ? 'Save' : 'Add event', save, { kind: 'primary' });
  const s = kit.sheet({
    title: ev ? 'Edit event' : 'New event',
    subtitle: ev?.repeat ? 'Changes apply to every session of this series.' : '',
    body: [h('div', { class: 'form' },
      h('div', { class: 'pair' },
        kit.labeled('Course', kit.picker({ options: ctx.courseOptions(true), value: v.course, title: 'Course', onChange: (x) => { v.course = x; check(); } })),
        kit.labeled('Kind', kit.picker({ options: U.kinds.map((k) => ({ label: U.kindLabel(k), value: k })), value: v.kind, onChange: (x) => { v.kind = x; } }))),
      h('label', { class: 'label' }, titleLabel, titleF),
      h('div', { class: 'quad' }, h('label', { class: 'label' }, dateLabel, dateF), kit.labeled('Start', startF), kit.labeled('End', endF), kit.labeled('Room', locF)),
      h('div', { class: 'label' }, h('span', { text: 'Repeat' }),
        kit.seg([{ label: 'Once', value: 'none' }, { label: 'Daily', value: 'daily' }, { label: 'Weekly', value: 'weekly' }, { label: 'Monthly', value: 'monthly' }, { label: 'Yearly', value: 'yearly' }], v.repeat, (x) => { v.repeat = x; check(); }),
        dayT, endsRow, summary))],
    footer: [
      ev ? kit.btn(ev.repeat ? 'Delete series' : 'Delete', async () => {
        if (await kit.confirm(ev.repeat ? 'Delete every session?' : 'Delete event?', ev.repeat ? 'This removes the whole series. To skip one date, open that session and choose Skip.' : 'This event will be removed from every device.', 'Delete', { danger: true })) {
          api.action('remove_event', { event_id: ev.id, scope: 'series' }).then(() => s.close());
        }
      }, { kind: 'danger', icon: 'trash' }) : null,
      h('span', { class: 'grow' }), kit.btn('Cancel', () => s.close()), saveBtn,
    ].filter(Boolean),
  });
  s.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') save(); });
  check();
  queueMicrotask(() => titleF.focus());
  return s;
}

// ---- a course: name, code, room, lecturer, colour, and (new) its weekly times ----
export function course(ctx, c) {
  const { api, U, kit, state } = ctx;
  const used = state.courses.map((x) => x.color);
  const v = {
    name: c?.name || '', code: c?.code || '', loc: c?.location || '', teacher: c?.teacher || '',
    color: c ? c.color : (U.palette.find((p) => !used.includes(p)) || U.palette[0]),
    slots: c ? [] : [{ day: 2, start: U.t('09:00'), end: U.t('11:00'), kind: 'lecture' }],
    until: '',
  };
  const nameF = kit.field({ value: v.name, placeholder: 'e.g. Algorithms', oninput: (x) => { v.name = x; check(); } });
  const codeF = kit.field({ value: v.code, placeholder: 'CS201', oninput: (x) => { v.code = x; } });
  const locF = kit.field({ value: v.loc, placeholder: 'Optional', oninput: (x) => { v.loc = x; } });
  const teacherF = kit.field({ value: v.teacher, placeholder: 'Optional', oninput: (x) => { v.teacher = x; } });
  const untilF = kit.field({ value: '', placeholder: 'YYYY-MM-DD', oninput: (x) => { v.until = x; check(); } });
  const swatches = h('div', { class: 'swatches' });
  const paintSwatches = () => swatches.replaceChildren(...U.palette.map((p) => h('button', { class: `sw ${v.color === p ? 'on' : ''}`, style: { '--c': p }, title: p, onclick: () => { v.color = p; paintSwatches(); } })));
  paintSwatches();
  const slotsBox = h('div', { class: 'stack8' });
  const slotsValid = () => v.slots.every((s) => U.isTime(s.start) && U.isTime(s.end) && U.minutes(s.end) > U.minutes(s.start));
  const valid = () => v.name.trim() !== '' && slotsValid() && (v.until === '' || U.isDate(v.until));
  let saveBtn;
  function drawSlots() {
    slotsBox.replaceChildren(...v.slots.map((sl, i) => {
      const st = kit.field({ value: sl.start, oninput: (x) => { sl.start = x; st.classList.toggle('invalid', !U.isTime(x)); check(); } });
      const en = kit.field({ value: sl.end, oninput: (x) => { sl.end = x; en.classList.toggle('invalid', !U.isTime(x) || (U.isTime(sl.start) && U.minutes(x) <= U.minutes(sl.start))); check(); } });
      return h('div', { class: 'slot' },
        kit.picker({ options: U.weekdays.map((w, j) => ({ label: w, value: j + 1 })), value: sl.day, onChange: (x) => { sl.day = x; } }),
        st, h('span', { class: 'muted', text: '–' }), en,
        kit.picker({ options: U.kinds.slice(0, 4).map((k) => ({ label: U.kindLabel(k), value: k })), value: sl.kind, onChange: (x) => { sl.kind = x; } }),
        kit.btn('', () => { v.slots.splice(i, 1); drawSlots(); check(); }, { kind: 'subtle', icon: 'close', compact: true, title: 'Remove this time' }));
    }));
  }
  function check() {
    untilF.classList.toggle('invalid', v.until !== '' && !U.isDate(v.until));
    if (saveBtn) saveBtn.disabled = !valid();
  }
  async function save() {
    if (!valid()) return;
    const base = { name: v.name.trim(), code: v.code.trim() || undefined, location: v.loc.trim() || undefined, teacher: v.teacher.trim() || undefined, color: v.color };
    try {
      if (c) await api.action('update_course', { course: c.id, ...base });
      else await api.action('add_course', { ...base, schedule: v.slots.map((s) => ({ day: s.day, start: U.parseTime(s.start), end: U.parseTime(s.end), kind: s.kind })), term_end: v.until || undefined });
      s.close();
    } catch {}
  }
  drawSlots();
  saveBtn = kit.btn(c ? 'Save' : 'Add course', save, { kind: 'primary' });
  untilF.style.width = '150px';
  const s = kit.sheet({
    title: c ? 'Edit course' : 'New course',
    subtitle: c ? '' : 'Add its weekly times now; you can change them later.',
    size: 'wide',
    body: [h('div', { class: 'form' },
      h('div', { class: 'pair' }, kit.labeled('Name', nameF), kit.labeled('Code', codeF)),
      h('div', { class: 'pair' }, kit.labeled('Default room', locF), kit.labeled('Lecturer', teacherF)),
      h('div', { class: 'label' }, h('span', { text: 'Colour' }), swatches),
      c ? null : h('div', { class: 'label' }, h('span', { text: 'Weekly times' }), slotsBox,
        h('div', { class: 'row' }, kit.btn('Add a time', () => { v.slots.push({ day: 4, start: U.t('14:00'), end: U.t('15:00'), kind: 'lab' }); drawSlots(); check(); }, { icon: 'plus', compact: true }),
          h('span', { class: 'grow' }), h('span', { class: 'label-inline', text: 'TERM ENDS' }), untilF)))],
    footer: [
      c ? kit.btn('Delete course', async () => {
        if (await kit.confirm(`Delete ${c.name}?`, 'Its sessions are removed from the calendar. Notes are kept in the inbox.', 'Delete', { danger: true })) {
          api.action('remove_course', { course: c.id }).then(() => s.close());
        }
      }, { kind: 'danger', icon: 'trash' }) : null,
      h('span', { class: 'grow' }), kit.btn('Cancel', () => s.close()), saveBtn,
    ].filter(Boolean),
  });
  check();
  queueMicrotask(() => nameF.focus());
  return s;
}
