// The page header every page draws (REDESIGN §3, round 5): the title and its context line, the page's tools and
// actions, Search or ask, and the window controls. Nothing in it ever overlaps or is cut off: a ResizeObserver
// measures the bar and gives way one step at a time, in priority order, until everything sits on its line.
//
//   one row:  Search or ask narrows · its Ctrl K and the buttons' key chips go · it becomes an icon · the context
//             line moves under the title · Back and the secondary buttons become icons (tooltips) · a page search
//             becomes an icon that opens over the toolbar
//   two rows: the title, Search or ask and the window controls on top; the tools and actions under them, where the
//             same steps run again, then quiet extras hide and secondary buttons, toggles and arrows go into one ⋯
//             menu. The title and the red primary action always show; the window controls never move off the edge.
//
// Pages keep building headers the old way (insertBefore a .ctx before .mid or .acts, swapping the h1): the bar
// gathers those into the title block before it measures.
import { h, icon } from './dom.js';
import { menuAt, btn } from './kit.js';
import { windowControls, dragRegion } from './window.js';

export function pageHead({ title, ctx: line, mid, acts = [], back, ask = true, sub, onAsk } = {}) {
  const titleEl = title instanceof Node ? title : h('h1', { text: title || '' });
  const ttl = h('div', { class: 'ttl' }, titleEl, line == null ? null : line instanceof Node ? line : h('span', { class: 'ctx', text: line }));
  const more = btn('', () => overflowMenu(bar, more), { kind: 'subtle', icon: 'more', title: 'More', cls: 'hmore' });
  more.hidden = true;
  const bar = h('header', { class: 'head' },
    back ? btn('Back', back, { kind: 'subtle', icon: 'back', title: 'Back (Esc)', cls: 'back' }) : null,
    ttl,
    mid ? h('div', { class: 'mid' }, mid) : null,
    h('div', { class: 'acts' }, acts),
    more,
    ask ? h('button', { class: 'ask', type: 'button', 'aria-label': 'Search or ask Hourglass (Ctrl K)', 'data-tip': 'Search or ask Hourglass (Ctrl K)', onclick: () => onAsk?.() },
      icon('search'), h('span', { class: 'lbl', text: 'Search or ask Hourglass' }), h('kbd', { text: 'Ctrl K' })) : null,
    windowControls());
  // The bar's empty parts drag the window (a double-click maximizes); buttons, fields and links stay clickable.
  dragRegion(bar, ttl, titleEl, ...bar.querySelectorAll(':scope > .mid, :scope > .acts'));
  for (const s of bar.querySelectorAll('.search')) wireSearch(bar, s);

  let queued = false;
  const later = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; if (bar.isConnected) fit(bar); }); };
  new ResizeObserver(later).observe(bar);
  // Text that changes (Schedule's range, a note's title, the Assistant's state) can change what fits.
  new MutationObserver(later).observe(bar, { childList: true, subtree: true, characterData: true });
  document.fonts?.ready.then(later);

  if (!sub) return bar;
  const row = h('div', { class: 'hsub' }, sub);
  dragRegion(row);
  return h('div', { class: 'head-stack' }, bar, row);
}

// ---- measuring ----------------------------------------------------------------------------------------
const shown = (el) => el && !el.hidden && el.getClientRects().length > 0;
const kids = (bar) => [...bar.children].filter(shown);
const ROW1 = ['back', 'ttl', 'ask', 'wctl'];
const rowOf = (el) => (ROW1.some((c) => el.classList.contains(c)) ? 1 : 2);

// Every item of a line sits on that line (same centre) and inside the bar; in two rows each row has its own line.
function lineFits(bar, items) {
  if (!items.length) return true;
  const cs = getComputedStyle(bar);
  const right = bar.getBoundingClientRect().right - parseFloat(cs.paddingRight) + 0.5;
  const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  const c = mid(items[0]);
  return items.every((el) => Math.abs(mid(el) - c) < 4 && el.getBoundingClientRect().right <= right + (el.classList.contains('wctl') ? parseFloat(cs.paddingRight) : 0));
}
function rowFits(bar, row) {
  const two = bar.classList.contains('two');
  const items = kids(bar).filter((el) => !two || row === 0 || rowOf(el) === row);
  return lineFits(bar, items);
}
const fits = (bar) => (bar.classList.contains('two') ? rowFits(bar, 1) && rowFits(bar, 2) : rowFits(bar, 0));

// ---- the steps ------------------------------------------------------------------------------------------
function tools(bar) {
  return [...bar.querySelectorAll(':scope > .mid > *, :scope > .acts > *')].filter((el) => !el.matches('.hc-ph'));
}
const kind = (el) => {
  if (el.matches('.btn.primary')) return 'primary';
  if (el.matches('.seg')) return 'seg';
  if (el.matches('.search')) return 'search';
  if (el.matches('.btn') && el.querySelector(':scope > .lbl')) return 'labelled';
  if (el.matches('.btn')) return 'icon';
  if (el.matches('button')) return 'soft';
  return 'static';
};

function iconOnly(el, on) {
  el.classList.toggle('hc-icon', on);
  if (on) {
    const label = el.querySelector(':scope > .lbl')?.textContent || el.getAttribute('title') || '';
    if (el.hasAttribute('title')) { el.dataset.hcTitle = el.getAttribute('title'); el.removeAttribute('title'); }
    if (!el.dataset.tip) { el.dataset.tip = el.dataset.hcTitle || label; el.dataset.hcTip = '1'; }
    if (!el.getAttribute('aria-label')) { el.setAttribute('aria-label', label); el.dataset.hcAria = '1'; }
  } else {
    if (el.dataset.hcTitle != null) { el.setAttribute('title', el.dataset.hcTitle); delete el.dataset.hcTitle; }
    if (el.dataset.hcTip) { delete el.dataset.tip; delete el.dataset.hcTip; }
    if (el.dataset.hcAria) { el.removeAttribute('aria-label'); delete el.dataset.hcAria; }
  }
}

function reset(bar, two) {
  bar.classList.toggle('two', two);
  bar.classList.remove('ask-mid', 'ask-icon', 'nokbd', 'stack', 'noctx', 'back-icon', 'tshrink');
  for (const el of tools(bar)) {
    if (el.matches('.search.hc-open')) continue;
    el.classList.remove('hc-over', 'hc-hide', 'hc-mid', 'hc-icon');
    if (el.matches('.search')) delete el.dataset.tip;
    iconOnly(el, false);
  }
  // The ⋯ button holds its slot while a page search is open over the toolbar; otherwise it shows only when used.
  bar.querySelector(':scope > .hmore').hidden = true;
  pushRight(bar);
}

// The first item of each line's right-hand group takes the free space (margin-left: auto). The ⋯ button follows the
// last tool, so with no actions it stays beside the page's tools instead of drifting to the edge.
function pushRight(bar) {
  const two = bar.classList.contains('two');
  const get = (c) => bar.querySelector(`:scope > .${c}`);
  const filled = (el) => shown(el) && (!el.matches('.acts') || [...el.children].some(shown));
  for (const el of bar.children) el.classList.remove('push');
  const groups = two ? [['ask', 'wctl'], ['acts']] : [['acts', 'ask', 'wctl']];
  for (const g of groups) { const el = g.map(get).find(filled); el?.classList.add('push'); }
}

function steps(bar, two) {
  const t = tools(bar);
  const of = (k) => t.filter((el) => kind(el) === k);
  const cls = (c, row) => ({ row, run: () => bar.classList.add(c) });
  const each = (list, row, run) => list.map((el) => ({ row, run: () => run(el) }));
  const over = (el) => { el.classList.add('hc-over'); bar.querySelector(':scope > .hmore').hidden = false; };
  const hasAsk = !!bar.querySelector(':scope > .ask');
  const hasCtx = !!bar.querySelector('.ttl > .ctx');
  const list = [
    hasAsk && cls('ask-mid', 1),
    ...each(of('search'), 2, (el) => el.classList.add('hc-mid')),
    cls('nokbd', 2),
    hasAsk && cls('ask-icon', 1),
    hasCtx && cls('stack', 1),
    bar.querySelector(':scope > .back') && cls('back-icon', 1),
    ...each(of('labelled'), 2, (el) => iconOnly(el, true)),
  ];
  if (two) {
    list.push(
      // A page search stays a field while one row is possible; on its own row it narrows to an icon last.
      ...each(of('search'), 2, (el) => { el.classList.add('hc-icon'); el.dataset.tip = el.querySelector('input')?.placeholder || 'Search'; }),
      ...each(of('soft'), 2, (el) => el.classList.add('hc-hide')),
      ...each(of('labelled'), 2, over),
      // Toggles fold before arrows: an arrow pair is narrow and used often.
      ...each(of('seg'), 2, over),
      ...each(of('icon'), 2, over),
      hasCtx && cls('noctx', 1),
      // The title block takes what's left of the top row; a very long title (a note's) ends in an ellipsis.
      cls('tshrink', 1),
      ...each(of('static'), 2, (el) => el.classList.add('hc-hide')),
      // The very last resort on a phone-narrow window: the red action keeps its icon and colour.
      ...each(of('primary'), 2, (el) => iconOnly(el, true)),
    );
  }
  return list.filter(Boolean);
}

export function fit(bar) {
  // Context lines the page slotted straight into the bar join the title block.
  const ttl = bar.querySelector(':scope > .ttl');
  for (const el of bar.querySelectorAll(':scope > .ctx, :scope > h1')) ttl.append(el);
  for (const el of ttl.children) dragRegion(el);
  for (const two of [false, true]) {
    reset(bar, two);
    if (fits(bar)) return;
    for (const s of steps(bar, two)) {
      if (two && rowFits(bar, s.row)) continue;
      s.run();
      pushRight(bar);
      if (fits(bar)) return;
    }
    if (two) return;
  }
}

// ---- the ⋯ menu ------------------------------------------------------------------------------------------
async function overflowMenu(bar, anchor) {
  const items = [];
  const acts = new Map();
  let n = 0;
  const add = (label, el, extra = {}) => { const key = 'k' + n++; acts.set(key, el); items.push({ key, label, iconEl: el.querySelector(':scope > svg.ic'), ...extra }); };
  for (const el of tools(bar).filter((x) => x.classList.contains('hc-over'))) {
    if (el.matches('.seg')) {
      if (items.length) items.push({ separator: true });
      for (const b of el.querySelectorAll(':scope > button')) add(b.textContent.trim() || b.getAttribute('title') || '', b, { checked: b.classList.contains('on') });
      items.push({ separator: true });
    } else {
      add(el.querySelector(':scope > .lbl')?.textContent || el.dataset.hcTitle || el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent.trim(), el);
    }
  }
  while (items.at(-1)?.separator) items.pop();
  const k = await menuAt(anchor, '', items, { right: true, width: 220 });
  acts.get(k)?.click();
}

// ---- a page search in the header ------------------------------------------------------------------------
// Narrowed to an icon it keeps its own slot; clicked, it opens over the toolbar (a placeholder keeps the slot) and
// Esc or clicking away closes it again.
function wireSearch(bar, s) {
  const input = s.querySelector('input');
  if (!input) return;
  const open = () => {
    if (!s.classList.contains('hc-icon') || s.classList.contains('hc-open')) return;
    const ph = h('span', { class: 'hc-ph' });
    s.before(ph);
    const b = bar.getBoundingClientRect();
    const ttl = bar.querySelector(':scope > .ttl').getBoundingClientRect();
    const end = (bar.querySelector(':scope > .ask') || bar.querySelector(':scope > .wctl')).getBoundingClientRect();
    const two = bar.classList.contains('two');
    const p = ph.getBoundingClientRect();
    const left = two ? parseFloat(getComputedStyle(bar).paddingLeft) : ttl.right - b.left + 16;
    const right = two ? parseFloat(getComputedStyle(bar).paddingRight) : b.right - end.left + 8;
    Object.assign(s.style, { left: `${Math.round(left)}px`, right: `${Math.round(right)}px`, top: `${Math.round(p.top - b.top + p.height / 2 - 18)}px` });
    s.classList.add('hc-open');
  };
  const close = () => {
    if (!s.classList.contains('hc-open')) return;
    s.classList.remove('hc-open');
    s.style.left = s.style.right = s.style.top = '';
    bar.querySelector(':scope .hc-ph')?.remove();
  };
  input.addEventListener('focus', open);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && s.classList.contains('hc-open')) { e.preventDefault(); e.stopPropagation(); input.value = ''; input.dispatchEvent(new Event('input')); input.blur(); } });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 160));
}

// Widths change when a font finishes loading (the bar's own size doesn't): measure every header again.
document.fonts?.addEventListener?.('loadingdone', () => { for (const bar of document.querySelectorAll('.head')) fit(bar); });
