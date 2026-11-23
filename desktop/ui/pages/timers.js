// Timers: one big number with Start / Stop, quick lengths, pause, +1 min, and timers scheduled for later
// (TimersPage.qml). Every device rings when a timer ends.
import { h, icon, swap } from '../dom.js';
import { timeSeg } from './alarms.js';

const QUICK = [5, 10, 15, 25, 30, 45, 60];

export default {
  mount(root, ctx, arg) {
    const { api, state, U, kit } = ctx;
    let timers = [];
    let length = Number(localStorage.getItem('hg.timerLength')) || 25; // minutes the next Start runs for

    const labelEl = h('div', { class: 'timer-label' });
    const bigEl = h('button', { class: 'timer-big tnum', title: 'Change the length' });
    // The ring drains with the time left (round 5 motion); at zero a red bloom and Done.
    const ring = h('div', { class: 'timer-ring', html: '<i class="bloom"></i><svg viewBox="0 0 200 200"><circle class="track" cx="100" cy="100" r="92" pathLength="1"/><circle class="bar" cx="100" cy="100" r="92" pathLength="1"/></svg><span class="done">Done</span>' });
    const actions = h('div', { class: 'row timer-acts' });
    const quick = h('div', { class: 'row wrap timer-quick' });
    const upcomingEl = h('div');
    const othersEl = h('div');
    root.append(ctx.head({ title: 'Timers', ctx: 'Rings on every device when it ends', mid: [timeSeg(ctx, 'timers')], acts: [kit.btn('Timer for later', () => ask(true), { icon: 'plus', kind: 'primary' })] }),
      h('div', { class: 'page' }, h('div', { class: 'timer-stage' }, labelEl, h('div', { class: 'timer-face' }, ring, bigEl), actions, quick, othersEl, upcomingEl)));
    bigEl.addEventListener('click', () => { if (!current()) ask(false); });

    const startsLater = (t) => (t.start_at || 0) > state.clock;
    const current = () => timers.filter((t) => (t.state === 'running' && !startsLater(t)) || t.state === 'paused').sort((a, b) => (a.ends_at || 0) - (b.ends_at || 0))[0] || null;
    const upcoming = () => timers.filter((t) => t.state === 'running' && startsLater(t)).sort((a, b) => a.start_at - b.start_at);
    const secsOf = (t) => (t.state === 'running' ? Math.max(0, Math.ceil((t.ends_at - state.clock) / 1000)) : t.remaining_s || 0);
    const act = (t, action) => api.action('update_timer', { timer_id: t.id, action });

    let lastText = '';
    function paintNumber() {
      const c = current();
      const text = U.countdown(c ? secsOf(c) : length * 60);
      if (text !== lastText) {
        bigEl.replaceChildren(...[...text].map((ch, i) => h('span', { class: lastText && lastText.length === text.length && lastText[i] !== ch ? 'roll' : '', text: ch })));
        lastText = text;
      }
      bigEl.classList.toggle('idle', !c);
      bigEl.disabled = !!c;
      const frac = c ? secsOf(c) / Math.max(1, c.duration_s || secsOf(c)) : 1;
      ring.style.setProperty('--p', String(Math.max(0, Math.min(1, frac))));
      ring.classList.toggle('on', !!c && c.state === 'running');
      ring.classList.toggle('zero', !!c && c.state === 'running' && secsOf(c) === 0);
    }

    let lastKey = '';
    function render() {
      paintNumber();
      const c = current();
      const key = JSON.stringify([timers, length, !!c]);
      if (key === lastKey) return;
      lastKey = key;
      labelEl.textContent = c ? (c.label || 'Timer') + (c.state === 'paused' ? ' · paused' : '') : 'Click the time to change it';
      swap(actions,
        c ? kit.btn(c.state === 'paused' ? 'Resume' : 'Pause', () => act(c, c.state === 'paused' ? 'resume' : 'pause'), { icon: c.state === 'paused' ? 'play' : 'pause', big: true }) : null,
        kit.btn(c ? 'Stop timer' : 'Start timer', (e) => {
          if (c) act(c, 'stop');
          else { ctx.burstAt(e.currentTarget); ctx.startTimer(length); }
        }, { kind: 'primary', icon: c ? 'stop' : 'play', big: true, cls: 'timer-main' }),
        c ? kit.btn('+1 min', () => act(c, 'add_minute'), { big: true }) : null);
      swap(quick, c ? null : QUICK.map((m) => h('button', { class: `qchip ${m === length ? 'on' : ''}`, onclick: () => setLength(m), text: `${m} min` })), c ? null : h('button', { class: 'qchip', onclick: () => ask(false), text: 'Custom' }));
      // Other timers running at the same time (an AI or the phone can start more than one).
      const others = timers.filter((t) => t !== c && !startsLater(t) && (t.state === 'running' || t.state === 'paused'));
      swap(othersEl, others.length ? h('div', { class: 'timer-list' }, kit.section('Also running', String(others.length)), others.map((t) => h('div', { class: 'tl-row static' },
        h('span', { class: 'tm tnum other-left', 'data-id': t.id, text: U.countdown(secsOf(t)) }), h('i', { class: 'dot', style: { '--c': t.state === 'running' ? 'var(--accent)' : 'var(--faint)' } }), h('span', { class: 'ttl ellipsis', text: t.label || 'Timer' }),
        kit.btn('', () => act(t, t.state === 'paused' ? 'resume' : 'pause'), { kind: 'subtle', icon: t.state === 'paused' ? 'play' : 'pause', compact: true }),
        kit.btn('', () => act(t, 'stop'), { kind: 'subtle', icon: 'trash', compact: true })))) : null);
      const up = upcoming();
      swap(upcomingEl, up.length ? h('div', { class: 'timer-list' }, kit.section('Upcoming', String(up.length)), up.map((t) => h('div', { class: 'tl-row static' },
        h('span', { class: 'tm tnum', text: U.clock(t.start_at) }), h('i', { class: 'dot', style: { '--c': 'var(--gold)' } }), h('span', { class: 'ttl ellipsis', text: (t.label || 'Timer') + ' · ' + U.countdown(t.duration_s) }),
        h('span'), kit.btn('', () => act(t, 'stop'), { kind: 'subtle', icon: 'trash', compact: true, title: 'Cancel' })))) : null);
    }

    function setLength(m) { length = Math.max(1, Math.round(m)); localStorage.setItem('hg.timerLength', String(length)); lastKey = ''; render(); }

    // Length (and, for later, when it starts and a label).
    function ask(later) {
      const minsF = kit.field({ value: String(length), onenter: () => submit() });
      minsF.style.width = '110px';
      const atF = kit.field({ placeholder: `Starts at, e.g. ${U.prefs.h24 ? '15:30' : '3:30 PM'}`, onenter: () => submit() });
      const labelF = kit.field({ placeholder: 'Label (optional)', onenter: () => submit() });
      const valid = () => { const n = Number(minsF.value); return n >= 0.1 && n <= 1440 && (!later || U.isTime(atF.value)); };
      async function submit() {
        if (!valid()) return;
        if (later) await api.action('start_timer', { minutes: Number(minsF.value), at: U.parseTime(atF.value), label: labelF.value }).catch(() => null);
        else setLength(Number(minsF.value));
        s.close();
      }
      const s = kit.sheet({
        title: later ? 'Timer for later' : 'Timer length', size: 'narrow',
        body: [h('div', { class: 'row' }, minsF, h('span', { class: 'muted', text: 'minutes' })),
          h('div', { class: 'row wrap' }, QUICK.map((m) => kit.btn(`${m} min`, () => { minsF.value = String(m); }, { compact: true, kind: 'subtle' }))),
          later ? atF : null, later ? labelF : null],
        footer: [h('span', { class: 'grow' }), kit.btn('Cancel', () => s.close()), kit.btn(later ? 'Schedule' : 'Set', submit, { kind: 'primary' })],
      });
      queueMicrotask(() => { minsF.focus(); minsF.select(); });
    }

    async function load() {
      const d = await api.action('list_timers', {}, { quiet: true }).catch(() => null);
      if (d) timers = d;
      render();
    }
    load();
    if (arg?.add) queueMicrotask(() => ask(false));
    const poll = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return {
      update(w) {
        if (w === 'tick') {
          paintNumber();
          for (const el of othersEl.querySelectorAll('.other-left')) { const t = timers.find((x) => x.id === el.dataset.id); if (t) el.textContent = U.countdown(secsOf(t)); }
          // A scheduled timer starting moves it up to the big number.
          if (upcoming().length !== upcomingEl.querySelectorAll('.tl-row').length) { lastKey = ''; render(); }
        } else if (w === 'data' || w === 'go') load();
      },
      unmount() { clearInterval(poll); },
    };
  },
};
