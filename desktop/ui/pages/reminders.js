// Reminders: "call mom at 6". Not alarms: at its time a reminder shows a notification and, if chosen, a short tone;
// then it waits as overdue until it is ticked, like a to-do (RemindersPage.qml). Its settings sync to every device.
import { h, icon, swap } from '../dom.js';

export default {
  mount(root, ctx, arg) {
    const { api, state, U, kit } = ctx;
    let reminders = [];
    let settings = { style: 'tone', tone: 'chime', snooze_min: 10, tones: ['chime', 'ding', 'pop', 'harp'] };
    let showDone = false;
    let editing = '';
    let repeats = false;
    let newDays = [1, 2, 3, 4, 5];

    const what = kit.field({ placeholder: 'Remind me to…', oninput: () => check(), onenter: () => save() });
    const timeF = kit.field({ placeholder: U.prefs.h24 ? '18:00' : '6:00 PM', oninput: () => check(), onenter: () => save() });
    timeF.style.width = '130px';
    const dateF = kit.field({ placeholder: 'YYYY-MM-DD', oninput: () => check(), onenter: () => save() });
    dateF.style.width = '150px';
    const dayT = h('span');
    const hint = h('small', { class: 'faint grow' });
    const cancelBtn = kit.btn('Cancel', () => clearForm(), { kind: 'subtle' });
    const saveBtn = kit.btn('Add reminder', () => save(), { kind: 'primary', icon: 'reminder' });
    const onceSeg = kit.seg([{ label: 'Once', value: false }, { label: 'Repeats', value: true }], repeats, (v) => { repeats = v; check(); });
    const form = h('div', { class: 'card alarm-form' }, what, h('div', { class: 'row wrap' }, timeF, onceSeg, dateF, dayT), h('div', { class: 'row' }, hint, cancelBtn, saveBtn));
    const listEl = h('div', { class: 'stack8' });
    const doneEl = h('div');
    const settingsEl = h('div');
    root.append(ctx.head({ title: 'Reminders', ctx: 'A notification with Done and Snooze, not an alarm', acts: [kit.btn('Alarms', () => ctx.go('alarms'), { icon: 'bell', kind: 'subtle' })] }),
      h('div', { class: 'page' }, h('div', { class: 'page-col' }, form, listEl, doneEl, settingsEl)));

    function drawDays() { dayT.replaceChildren(kit.days(newDays, (d) => { newDays = d; check(); })); }
    function check() {
      timeF.classList.toggle('invalid', timeF.value !== '' && !U.isTime(timeF.value));
      dateF.classList.toggle('invalid', dateF.value !== '' && !U.isDate(dateF.value));
      dateF.hidden = repeats;
      dayT.hidden = !repeats;
      onceSeg.set(repeats);
      hint.textContent = repeats ? 'Shows on the highlighted days; tick it done each time.' : dateF.value === '' ? 'No day: today, or tomorrow if that time has passed.' : 'Shows once, then waits until you tick it done.';
      cancelBtn.hidden = !editing;
      saveBtn.querySelector('.lbl').textContent = editing ? 'Save' : 'Add reminder';
      saveBtn.disabled = !(what.value.trim() !== '' && U.isTime(timeF.value) && (repeats ? newDays.length > 0 : (dateF.value === '' || U.isDate(dateF.value))));
    }
    function startEdit(r) {
      editing = r.id;
      what.value = r.label;
      timeF.value = U.t(r.time);
      repeats = !!(r.days && r.days.length);
      newDays = repeats ? r.days : [1, 2, 3, 4, 5];
      dateF.value = r.date || '';
      drawDays();
      check();
      what.focus();
    }
    function clearForm() { editing = ''; what.value = ''; timeF.value = ''; dateF.value = ''; repeats = false; newDays = [1, 2, 3, 4, 5]; drawDays(); check(); }
    async function save() {
      if (saveBtn.disabled) return;
      const args = { label: what.value.trim(), time: U.parseTime(timeF.value) };
      if (repeats) args.days = newDays;
      else if (U.isDate(dateF.value)) args.date = dateF.value;
      else if (editing) {
        // A time alone: today, or tomorrow once it has passed.
        const today = U.dayOf(state.clock);
        args.date = U.minutes(timeF.value) > U.minutesOf(state.clock) ? today : U.addDays(today, 1);
      }
      if (editing) await api.action('update_reminder', { reminder_id: editing, ...args }).catch(() => null);
      else await api.action('add_reminder', args).catch(() => null);
      clearForm();
      load();
    }

    function whenText(r) {
      const d = r.days || [];
      const repeat = !d.length ? '' : d.length === 7 ? 'Every day' : d.join() === '1,2,3,4,5' ? 'Weekdays' : d.join() === '6,7' ? 'Weekends' : d.map((x) => U.weekdays[x - 1]).join(', ');
      if (r.done) return 'Done' + (r.time ? '  ·  ' + U.t(r.time) : '');
      const at = r.due_at || r.occurrence;
      let day = '';
      if (at) {
        const dd = U.dayOf(at), today = U.dayOf(state.clock);
        day = dd === today ? 'today' : dd === U.addDays(today, 1) ? 'tomorrow' : dd === U.addDays(today, -1) ? 'yesterday' : U.shortDate(dd);
      }
      const parts = [(at ? U.clock(at) : U.t(r.time)) + (day ? ' ' + day : '')];
      if (repeat) parts.push(repeat);
      if (r.snooze_at && r.snooze_at > state.clock) parts.push('snoozed');
      else if (r.overdue) parts.push('overdue');
      return parts.join('  ·  ');
    }

    function row(r) {
      const tick = h('button', { class: `tick ${r.done ? 'on' : ''}`, title: r.done ? 'Not done' : 'Done', onclick: (e) => {
        if (!r.done) ctx.burstAt(e.currentTarget);
        api.action('update_reminder', { reminder_id: r.id, action: r.done ? 'undone' : 'done' }).then(load);
      } }, r.done ? icon('check') : null);
      return h('div', { class: `card rem-row ${r.done ? 'done' : ''} ${r.overdue ? 'stripe' : ''}`, 'data-id': r.id },
        tick,
        h('div', { class: 'col grow' }, h('span', { class: 'ellipsis rem-label', text: r.label }), h('small', { class: r.overdue ? 'ellipsis overdue' : 'ellipsis muted', text: whenText(r) })),
        r.overdue ? kit.btn('', () => api.action('update_reminder', { reminder_id: r.id, action: 'snooze' }).then(load), { kind: 'subtle', icon: 'timer', title: `Snooze ${settings.snooze_min} min` }) : null,
        !r.done ? kit.btn('', () => startEdit(r), { kind: 'subtle', icon: 'edit', title: 'Change' }) : null,
        kit.btn('', () => api.action('remove_reminder', { reminder_id: r.id }).then(load), { kind: 'subtle', icon: 'trash', title: 'Delete' }));
    }

    function settingsBlock() {
      const setS = (args) => api.action('set_reminder_settings', args).then(load);
      return h('div', { class: 'stack12' }, kit.section('Reminder settings'),
        h('small', { class: 'faint', text: 'A reminder is a notification with Done and Snooze, not an alarm. These settings are the same on all your devices.' }),
        h('div', { class: 'set-row' }, h('span', { class: 'muted', text: 'Alert' }), kit.seg([{ label: 'With a tone', value: 'tone' }, { label: 'Notification only', value: 'silent' }], settings.style, (v) => setS({ style: v }))),
        settings.style === 'tone' ? h('div', { class: 'set-row' }, h('span', { class: 'muted', text: 'Tone' }), h('div', { class: 'row wrap' }, (settings.tones || []).map((t) => kit.btn(t.charAt(0).toUpperCase() + t.slice(1), () => {
          api.post('/api/ring/preview?reminder=1&name=' + t, {}, { readOnly: true });
          setS({ tone: t });
        }, { kind: 'subtle', compact: true, icon: 'play', cls: settings.tone === t ? 'active' : '', title: 'Choose and hear it' })))) : null,
        h('div', { class: 'set-row' }, h('span', { class: 'muted', text: 'Snooze' }), kit.seg([5, 10, 15, 30, 60].map((m) => ({ label: m === 60 ? '1 hour' : `${m} min`, value: m })), settings.snooze_min, (v) => setS({ snooze_min: v }))));
    }

    let lastKey = '';
    async function load() {
      const [r, s] = await Promise.all([
        api.action('list_reminders', {}, { quiet: true }).catch(() => null),
        api.action('reminder_settings', {}, { quiet: true, readOnly: true }).catch(() => null),
      ]);
      if (r) reminders = r;
      if (s) settings = s;
      const key = JSON.stringify([reminders, settings, showDone, Math.floor(state.clock / 60000)]);
      if (key === lastKey) return;
      lastKey = key;
      const open = reminders.filter((x) => !x.done), done = reminders.filter((x) => x.done).slice(0, 20);
      swap(listEl, open.length ? open.map(row) : h('div', { class: 'quiet', text: 'No reminders. Add one above, or ask the assistant: "remind me to call mom at 6".' }));
      swap(doneEl, done.length ? h('div', { class: 'stack8' }, kit.section('Done', String(done.length), kit.btn(showDone ? 'Hide' : 'Show', () => { showDone = !showDone; lastKey = ''; load(); }, { kind: 'subtle', compact: true })), showDone ? done.map(row) : null) : null);
      swap(settingsEl, settingsBlock());
    }
    drawDays();
    check();
    load();
    if (arg?.add) queueMicrotask(() => what.focus());
    const poll = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return { update(w) { if (w === 'data' || w === 'go') load(); }, unmount() { clearInterval(poll); } };
  },
};
