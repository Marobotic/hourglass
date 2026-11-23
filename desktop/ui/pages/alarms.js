// Alarms: at a time (repeating on days, or once), or N minutes before every session of a course (TimePage.qml).
// Round 5: the next ring first, then every alarm as a card with its days, its next ring and Skip once (a skipped
// ring is struck through in gold with Undo skip); on the right the next 48 hours and the sound.
import { h, icon, swap } from '../dom.js';
import { timeline } from './parts.js';

export default {
  mount(root, ctx, arg) {
    const { api, state, U, kit } = ctx;
    let alarms = [];
    let tones = [];
    let first = true;
    const main = h('div', { class: 'col' });
    const rail = h('div', { class: 'rail' });
    const headCtx = h('span', { class: 'ctx' });
    const head = ctx.head({ title: 'Alarms', mid: [timeSeg(ctx, 'alarms')], acts: [kit.btn('New alarm', () => addSheet(), { kind: 'primary', icon: 'plus' })] });
    head.insertBefore(headCtx, head.querySelector('.mid'));
    root.append(head, h('div', { class: 'page' }, h('div', { class: 'cols' }, main, rail)));
    const today = () => U.dayOf(state.clock);
    const dayWord = (ms) => { const d = U.dayOf(ms); return d === today() ? 'today' : d === U.addDays(today(), 1) ? 'tomorrow' : U.shortDate(d); };

    function subtitle(a) {
      if (a.lead_course_id || a.lead_event_id) {
        const c = ctx.courseById(a.lead_course_id);
        return `Rings ${a.lead_minutes} min before ${c ? `every ${c.name} session` : 'the lecture'}`;
      }
      if (a.date) return 'Once, ' + U.shortDate(a.date);
      if (!a.days || !a.days.length) return 'Every day';
      if (a.days.length === 7) return 'Every day';
      if (a.days.length === 5 && a.days.every((d) => d <= 5)) return 'Weekdays';
      if (a.days.length === 2 && a.days.every((d) => d >= 6)) return 'Weekends';
      return a.days.map((d) => U.weekdays[d - 1]).join(', ');
    }

    // ---- a new alarm: at a time (days, label) or before a course ----
    function addSheet() {
      let mode = 'time';
      let newDays = [1, 2, 3, 4, 5];
      const timeF = kit.field({ placeholder: U.prefs.h24 ? '07:30' : '7:30 AM', oninput: () => check(), onenter: () => add() });
      const labelF = kit.field({ placeholder: 'Label (optional)', onenter: () => add() });
      const leadF = kit.field({ value: '15', oninput: () => check(), onenter: () => add() });
      leadF.style.width = '80px';
      const coursePick = kit.picker({ options: ctx.courseOptions(false), value: state.courses[0]?.id ?? null, title: 'Course', onChange: () => check() });
      const dayT = kit.days(newDays, (d) => { newDays = d; check(); });
      const hint = h('small', { class: 'faint' });
      const timeRow = h('div', { class: 'stack12' }, kit.labeled('Time', timeF), kit.labeled('Days', dayT), kit.labeled('Label', labelF));
      const beforeRow = h('div', { class: 'row wrap' }, leadF, h('span', { class: 'muted', text: 'min before every session of' }), coursePick);
      const modeSeg = kit.seg([{ label: 'At a time', value: 'time' }, { label: 'Before a course', value: 'before' }], mode, (m) => { mode = m; check(); });
      if (!state.courses.length) modeSeg.querySelectorAll('button')[1].disabled = true;
      let addBtn;
      function check() {
        timeRow.hidden = mode !== 'time';
        beforeRow.hidden = mode !== 'before';
        timeF.classList.toggle('invalid', timeF.value !== '' && !U.isTime(timeF.value));
        hint.textContent = mode === 'time' ? (newDays.length ? 'Repeats on the highlighted days.' : 'No days selected: rings once, at the next matching time.') : 'Rings on this computer and your phone once synced.';
        const n = Number(leadF.value);
        if (addBtn) addBtn.disabled = mode === 'time' ? !U.isTime(timeF.value) : !(coursePick.value != null && Number.isFinite(n) && n >= 0 && n <= 600);
      }
      async function add() {
        if (addBtn.disabled) return;
        if (mode === 'time') {
          const args = { time: U.parseTime(timeF.value), days: newDays, label: labelF.value };
          if (!newDays.length) args.date = U.minutes(timeF.value) > U.minutesOf(state.clock) ? today() : U.addDays(today(), 1);
          await api.action('set_alarm', args).catch(() => null);
        } else await api.action('set_alarm', { before: coursePick.value, minutes_before: Number(leadF.value) }).catch(() => null);
        ctx.burstAt(addBtn);
        s.close();
        load();
      }
      addBtn = kit.btn('Add alarm', () => add(), { kind: 'primary', icon: 'bell' });
      const s = kit.sheet({ title: 'New alarm', subtitle: 'Rings on this computer and your phone.', body: [modeSeg, timeRow, beforeRow, hint], footer: [h('span', { class: 'grow' }), kit.btn('Cancel', () => s.close()), addBtn] });
      check();
      queueMicrotask(() => timeF.focus());
    }

    // ---- the cards ----
    async function skip(a) {
      const r = await api.action('skip_alarm', { alarm_id: a.id, date: U.dayOf(a.next_at) }).catch(() => null);
      if (!r) return;
      kit.toast(`Skipped the ${U.clock(r.skipped_at)} ring ${dayWord(r.skipped_at)}`, { action: 'Undo', onAction: () => unskip(a) });
      load();
    }
    const unskip = (a) => api.action('skip_alarm', { alarm_id: a.id, undo: true }).then(load).catch(() => null);

    function nextRing() {
      const on = alarms.filter((a) => a.enabled && a.next_at).sort((a, b) => a.next_at - b.next_at);
      const a = on[0];
      if (!a) return null;
      const then = on[1];
      const mins = Math.ceil((a.next_at - state.clock) / 60000);
      return h('div', { class: 'nextring' },
        h('div', { class: 'row' }, h('span', { class: 'eyebrow', text: 'Next ring' }), h('span', { class: 'grow' }), h('span', { class: 'muted tnum nr-in', text: U.relative(mins) })),
        h('div', { class: 'tt tnum', text: U.clock(a.next_at) }),
        h('b', { text: a.label || 'Alarm' }),
        h('small', { text: [dayWord(a.next_at).replace(/^./, (c) => c.toUpperCase()), then ? `then ${then.label || 'Alarm'} ${U.clock(then.next_at)} ${dayWord(then.next_at) === 'today' ? '' : U.weekdayOf(U.dayOf(then.next_at))}`.trim() : ''].filter(Boolean).join(' · ') }));
    }

    function card(a, soonest) {
      const c = ctx.courseById(a.lead_course_id);
      const time = a.time ? U.t(a.time) : a.next_at ? U.clock(a.next_at) : '—';
      const skipped = a.skipped_at && a.enabled;
      const sw = kit.toggle(a.enabled, (on) => { if (on) ctx.burstAt(sw); api.put('/api/alarms/' + a.id, { enabled: on }).then(load); }, { title: a.enabled ? 'On' : 'Off' });
      const mins = a.next_at ? Math.ceil((a.next_at - state.clock) / 60000) : 0;
      return h('div', { class: `card al ${a.enabled ? '' : 'off'} ${skipped ? 'skipped' : ''}`, style: c ? { '--c': c.color } : null, 'data-id': a.id },
        c ? h('i', { class: 'edge' }) : null,
        h('div', { class: 'al-top' },
          h('div', { class: 'grow' },
            h('div', { class: 'tt tnum', text: time }),
            h('div', { class: 'lb ellipsis', text: a.label || (c ? c.name : 'Alarm') }),
            h('div', { class: 'ds ellipsis', text: subtitle(a) }),
            skipped ? [h('div', { class: 'skipline' }, icon('skip'), h('span', {}, 'Skipped once · ', h('s', { text: `${U.shortDate(U.dayOf(a.skipped_at))} ${U.clock(a.skipped_at)}` }))),
              a.next_at ? h('div', { class: 'ds', text: `Rings again ${U.shortDate(U.dayOf(a.next_at))} ${U.clock(a.next_at)}` }) : null]
              : a.enabled && a.next_at ? h('div', { class: `ds tnum ${a === soonest ? 'soon' : ''}`, text: `Next ring ${dayWord(a.next_at)}${mins < 24 * 60 ? ' · ' + U.relative(mins) : ' · ' + U.clock(a.next_at)}` }) : null),
          sw),
        h('div', { class: 'al-foot' },
          a.days?.length && !a.lead_course_id && !a.lead_event_id ? kit.days(a.days, null, { readOnly: true, small: true }) : null,
          h('span', { class: 'grow' }),
          skipped ? kit.btn('Undo skip', () => unskip(a), { kind: 'ghost', icon: 'undo', compact: true })
            : a.enabled && a.next_at ? kit.btn('Skip once', () => skip(a), { kind: 'ghost', icon: 'skip', compact: true, title: `Skip only the ${dayWord(a.next_at)} ring; the alarm stays on` }) : null,
          kit.btn('', () => api.action('remove_alarm', { alarm_id: a.id }).then(load), { kind: 'subtle', icon: 'trash', compact: true, title: 'Delete alarm' })));
    }

    // ---- the rail ----
    function next48() {
      const until = state.clock + 48 * 3600000;
      const items = [];
      for (const a of alarms) {
        if (!a.enabled) continue;
        const c = ctx.courseById(a.lead_course_id);
        if (a.skipped_at && a.skipped_at < until) items.push({ at: a.skipped_at, a, c, skipped: true });
        if (a.next_at && a.next_at < until) items.push({ at: a.next_at, a, c });
      }
      if (!items.length) return null;
      items.sort((x, y) => x.at - y.at);
      return h('div', { class: 'card raised rail-card' }, kit.section('Next 48 hours'),
        timeline(items.map((it, i) => ({
          time: U.clock(it.at), color: it.skipped ? 'var(--gold)' : it.c?.color || 'var(--accent)', title: it.a.label || 'Alarm', dim: it.skipped, next: i === 0 && !it.skipped,
          sub: `${dayWord(it.at).replace(/^./, (ch) => ch.toUpperCase())}${it.skipped ? ' · skipped once' : ''}`,
        }))),
        h('p', { class: 'rail-note', text: 'Stop it on one device and it stops everywhere. A skipped ring never comes back as a snooze.' }));
    }
    function sound() {
      const t = tones.find((x) => x.selected) || tones[0];
      const s = state.settings || {};
      return h('div', { class: 'card rail-card' }, kit.section('Sound'),
        h('div', { class: 'row sound' }, h('span', { class: 'bellbox' }, icon('volume')),
          h('div', { class: 'grow' }, h('b', { class: 'ellipsis', text: t ? t.name : 'Classic' }), h('small', { text: `${s.sound === false ? 'Sound off: a notification only' : 'Rings on every device'} · snooze 5 min` })),
          kit.btn('Test', async () => { await api.post('/api/ring/test', {}, { readOnly: true, quiet: true }).catch(() => null); ctx.pollState(); }, { compact: true, title: 'Ring now like a real alarm' })),
        h('button', { class: 'link rail-link', text: 'Ringtones and alarm settings', onclick: () => ctx.go('settings') }));
    }

    let lastKey = '';
    function render() {
      const key = JSON.stringify([alarms, tones.map((t) => t.id + t.selected), state.settings?.sound, U.hhmmOf(state.clock)]);
      if (key === lastKey) return;
      lastKey = key;
      headCtx.textContent = `${U.plural(alarms.length, 'alarm')} · ${alarms.filter((a) => a.enabled).length} on`;
      const on = alarms.filter((a) => a.enabled && a.next_at).sort((a, b) => a.next_at - b.next_at);
      const cards = alarms.map((a) => card(a, on[0]));
      const half = Math.ceil(cards.length / 2);
      swap(main,
        nextRing(),
        alarms.length ? h('div', { class: `al-grid ${first ? 'stagger' : ''}` }, h('div', { class: 'stack16' }, cards.slice(0, half)), h('div', { class: 'stack16' }, cards.slice(half))) : null);
      swap(rail, next48(), sound());
      first = false;
    }
    async function load() {
      const [d, t] = await Promise.all([api.action('list_alarms', {}, { quiet: true }).catch(() => null), api.get('/api/ringtones', { quiet: true }).catch(() => null)]);
      if (d) alarms = d;
      if (t) tones = t;
      render();
    }
    load();
    if (arg?.add) queueMicrotask(() => addSheet());
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return { update(w) { if (w === 'data' || w === 'go') load(); else if (w === 'tick') render(); }, unmount() { clearInterval(timer); } };
  },
};

// The Time pages, as the header's segmented control (the sidebar lists them too).
export function timeSeg(ctx, on) {
  return ctx.kit.seg([{ label: 'Alarms', value: 'alarms' }, { label: 'Reminders', value: 'reminders' }, { label: 'Timers', value: 'timers' }, { label: 'World clock', value: 'world' }], on, (v) => ctx.go(v));
}
