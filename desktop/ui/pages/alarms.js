// Alarms: at a time (repeating on days, or once), or N minutes before every session of a course (TimePage.qml).
import { h, icon, swap } from '../dom.js';

export default {
  mount(root, ctx, arg) {
    const { api, state, U, kit } = ctx;
    let alarms = [];
    let first = true;
    const list = h('div', { class: 'stack8' });
    const form = newForm();
    root.append(ctx.head({ title: 'Alarms', ctx: 'Ring on this computer and your phone', acts: [kit.btn('Reminders', () => ctx.go('reminders'), { icon: 'reminder', kind: 'subtle' })] }),
      h('div', { class: 'page' }, h('div', { class: 'page-col' }, form.el, h('div', {}, kit.section('Your alarms', ''), list))));

    function subtitle(a) {
      if (a.lead_course_id || a.lead_event_id) {
        const c = ctx.courseById(a.lead_course_id);
        return `Rings ${a.lead_minutes} min before ${c ? c.name : 'the lecture'}`;
      }
      if (a.date) return 'Once, ' + U.shortDate(a.date);
      if (!a.days || !a.days.length) return 'Every day';
      if (a.days.length === 5 && a.days.every((d) => d <= 5)) return 'Weekdays';
      if (a.days.length === 2 && a.days.every((d) => d >= 6)) return 'Weekends';
      return a.days.map((d) => U.weekdays[d - 1]).join(', ');
    }

    function newForm() {
      let mode = 'time';
      let newDays = [1, 2, 3, 4, 5];
      const timeF = kit.field({ placeholder: U.prefs.h24 ? '07:30' : '7:30 AM', oninput: () => check(), onenter: () => add() });
      timeF.style.width = '130px';
      const labelF = kit.field({ placeholder: 'Label', onenter: () => add() });
      const leadF = kit.field({ value: '15', oninput: () => check(), onenter: () => add() });
      leadF.style.width = '70px';
      const coursePick = kit.picker({ options: ctx.courseOptions(false), value: state.courses[0]?.id ?? null, title: 'Course', onChange: () => check() });
      const dayT = kit.days(newDays, (d) => { newDays = d; check(); });
      const hint = h('small', { class: 'faint grow' });
      const addBtn = kit.btn('Add alarm', () => add(), { kind: 'primary', icon: 'bell' });
      const timeRow = h('div', { class: 'row wrap alarm-form-row' }, timeF, dayT, labelF);
      const beforeRow = h('div', { class: 'row wrap alarm-form-row' }, leadF, h('span', { class: 'muted', text: 'min before every session of' }), coursePick);
      const modeSeg = kit.seg([{ label: 'At a time', value: 'time' }, { label: 'Before a course', value: 'before' }], mode, (m) => { mode = m; check(); });
      function check() {
        timeRow.hidden = mode !== 'time';
        beforeRow.hidden = mode !== 'before';
        timeF.classList.toggle('invalid', timeF.value !== '' && !U.isTime(timeF.value));
        hint.textContent = mode === 'time' ? (newDays.length ? 'Repeats on the highlighted days.' : 'No days selected: rings once, at the next matching time.') : 'Rings on this computer and your phone once synced.';
        const n = Number(leadF.value);
        addBtn.disabled = mode === 'time' ? !U.isTime(timeF.value) : !(coursePick.value != null && Number.isFinite(n) && n >= 0 && n <= 600);
      }
      async function add() {
        if (addBtn.disabled) return;
        if (mode === 'time') {
          const args = { time: U.parseTime(timeF.value), days: newDays, label: labelF.value };
          if (!newDays.length) {
            const today = U.dayOf(state.clock);
            args.date = U.minutes(timeF.value) > U.minutesOf(state.clock) ? today : U.addDays(today, 1);
          }
          await api.action('set_alarm', args).catch(() => null);
          timeF.value = ''; labelF.value = '';
        } else {
          await api.action('set_alarm', { before: coursePick.value, minutes_before: Number(leadF.value) }).catch(() => null);
        }
        check();
        ctx.burstAt(addBtn);
      }
      const el = h('div', { class: 'card alarm-form' }, h('div', { class: 'row' }, modeSeg, h('span', { class: 'grow' })), timeRow, beforeRow, h('div', { class: 'row' }, hint, addBtn));
      check();
      return { el, focus: () => timeF.focus(), refresh: () => { coursePick.setOptions(ctx.courseOptions(false)); if (coursePick.value == null && state.courses[0]) coursePick.set(state.courses[0].id); modeSeg.querySelectorAll('button')[1].disabled = !state.courses.length; } };
    }

    function row(a) {
      const c = ctx.courseById(a.lead_course_id);
      const time = a.time ? U.t(a.time) : a.next_at ? U.clock(a.next_at) : '—';
      const sw = kit.toggle(a.enabled, (on) => { if (on) ctx.burstAt(sw); api.put('/api/alarms/' + a.id, { enabled: on }); }, { title: a.enabled ? 'On' : 'Off' });
      return h('div', { class: `card alarm-row ${a.enabled ? '' : 'disabled'} ${c ? 'stripe' : ''}`, style: c ? { '--c': c.color } : null, 'data-id': a.id },
        h('span', { class: 'alarm-time tnum', text: time }),
        h('div', { class: 'col grow' },
          h('span', { class: 'ellipsis', text: a.label || (c ? c.name : 'Alarm') }),
          h('small', { class: 'muted ellipsis', text: subtitle(a) + (a.next_at && a.enabled ? '  ·  next ' + U.shortDate(U.dayOf(a.next_at)) + ' ' + U.clock(a.next_at) : '') })),
        a.days?.length && !a.lead_course_id ? kit.days(a.days, null, { readOnly: true, small: true }) : null,
        sw,
        kit.btn('', async () => { api.action('remove_alarm', { alarm_id: a.id }); }, { kind: 'subtle', icon: 'trash', title: 'Delete alarm' }));
    }

    let lastKey = '';
    async function load() {
      const d = await api.action('list_alarms', {}, { quiet: true }).catch(() => null);
      if (!d) return;
      alarms = d;
      form.refresh();
      const key = JSON.stringify(alarms);
      if (key === lastKey) return;
      lastKey = key;
      swap(list, alarms.length ? h('div', { class: `stack8 ${first ? 'stagger' : ''}` }, alarms.map(row)) : h('div', { class: 'quiet', text: 'No alarms yet. Add one above.' }));
      first = false;
    }
    load();
    if (arg?.add) queueMicrotask(() => form.focus());
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return { update(w) { if (w === 'data' || w === 'go') load(); }, unmount() { clearInterval(timer); } };
  },
};
