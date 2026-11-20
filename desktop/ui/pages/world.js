// World clock: cities side by side; the home clock is the app's time zone on every device (WorldClockPage.qml).
import { h, icon, swap, debounce } from '../dom.js';

export default {
  mount(root, ctx) {
    const { api, state, U, kit } = ctx;
    let clocks = [];
    let hits = [];
    let kb = 0;
    const ctxLine = h('span', { class: 'ctx' });
    const q = kit.field({ placeholder: 'Add a city, e.g. Tokyo' });
    const drop = h('div', { class: 'zone-drop', hidden: true });
    const searchBox = h('div', { class: 'search zone-search' }, icon('search'), q, drop);
    const head = ctx.head({ title: 'World clock', acts: [searchBox] });
    head.insertBefore(ctxLine, head.querySelector('.acts'));
    const grid = h('div', { class: 'clock-grid stagger' });
    root.append(head, h('div', { class: 'page' }, grid));

    const search = debounce(async (text) => {
      if (!text.trim()) { hits = []; paintHits(); return; }
      const d = await api.get('/api/timezones?q=' + encodeURIComponent(text), { quiet: true }).catch(() => null);
      hits = (d || []).slice(0, 10);
      kb = 0;
      paintHits();
    }, 200);
    q.addEventListener('input', () => search(q.value));
    q.addEventListener('focus', paintHits);
    q.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 150));
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; hits = []; paintHits(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); kb = Math.min(hits.length - 1, kb + 1); paintHits(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); kb = Math.max(0, kb - 1); paintHits(); }
      else if (e.key === 'Enter' && hits[kb]) addZone(hits[kb].zone);
    });

    function paintHits() {
      drop.hidden = !(document.activeElement === q && q.value && hits.length);
      drop.replaceChildren(...hits.map((z, i) => h('button', { class: i === kb ? 'kb' : '', onmousedown: (e) => { e.preventDefault(); addZone(z.zone); } },
        h('span', { text: z.city }), h('span', { class: 'faint grow ellipsis', text: z.zone.split('/')[0].replace('_', ' ') }), h('span', { class: 'muted tnum', text: U.clockAt(state.clock, z.offset_min) }))));
    }
    async function addZone(zone) {
      await api.action('add_clock', { zone }).catch(() => null);
      q.value = ''; hits = []; paintHits();
    }

    function card(c) {
      const date = U.dateAt(state.clock, c.offset_min), home = U.dayOf(state.clock);
      const hr = new Date(state.clock + c.offset_min * 60000).getUTCHours();
      const night = hr < 6 || hr >= 19;
      return h('div', { class: `card clock-card ${c.home ? 'stripe home' : ''}`, 'data-id': c.id || c.zone },
        h('div', { class: 'row' }, h('b', { class: 'grow ellipsis', text: c.label }),
          c.home ? kit.chip('App time', { cls: 'live' }) : kit.btn('', () => api.action('remove_clock', { clock_id: c.id }), { kind: 'subtle', icon: 'close', compact: true, title: 'Remove' })),
        h('div', { class: 'row clock-time' }, h('span', { class: 'tnum cc-time', 'data-off': String(c.offset_min), text: U.clockAt(state.clock, c.offset_min) }), icon(night ? 'moon' : 'sun', 'muted daynight')),
        h('div', { class: 'muted', text: (date === home ? 'Today' : date > home ? 'Tomorrow' : 'Yesterday') + (c.home ? '' : '  ·  ' + U.diffText(c.diff_min)) }),
        c.home ? null : kit.btn('Use as app time', () => api.action('set_home_zone', { clock_id: c.id }).then(() => ctx.pollState()), { kind: 'subtle', compact: true, cls: 'self-start' }));
    }

    let lastKey = '';
    async function load() {
      const d = await api.action('world_clock', {}, { quiet: true }).catch(() => null);
      if (!d) return;
      clocks = d;
      const homeC = clocks.find((c) => c.home);
      ctxLine.textContent = homeC ? `Hourglass runs on ${homeC.label} time` : '';
      const key = JSON.stringify(clocks) + U.dayOf(state.clock);
      if (key === lastKey) return;
      lastKey = key;
      swap(grid, clocks.map(card));
      requestAnimationFrame(() => grid.classList.add('settled'));
    }
    load();
    const poll = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30000);
    return {
      update(w) {
        if (w === 'tick') for (const el of grid.querySelectorAll('.cc-time')) el.textContent = U.clockAt(state.clock, Number(el.dataset.off));
        else if (w === 'data' || w === 'go') load();
      },
      unmount() { clearInterval(poll); },
    };
  },
};
