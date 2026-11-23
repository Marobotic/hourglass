// Pieces several pages share (round 5): the note card, the live class card's progress line, the rail timeline.
import { h, icon } from '../dom.js';

// A note's to-dos, in order: { text, done }.
export function todosOf(U, body) {
  const out = [];
  for (const line of (body || '').split('\n')) {
    const m = U.taskRe.exec(line);
    if (m) out.push({ text: U.plain(m[3]).trim(), done: m[2] !== ' ', ind: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)) });
  }
  return out;
}

// A note card: the course edge, title (pin in gold), a preview in Noto Sans or its to-dos with the real 0.3.4 boxes,
// then course · when · done count. lines: preview lines (2, 4, 6); todoMax: to-dos shown before "n more".
export function noteCard(ctx, n, { today, onclick, showCourse = true, lines = 2, todoMax = 3, active = false } = {}) {
  const { U } = ctx;
  const c = ctx.courseById(n.course_id);
  const when = n.session_date === today ? 'Today' : n.pinned ? 'Pinned' : n.session_date ? U.shortDate(n.session_date) : U.ago(n.updated_at, ctx.state.clock);
  const todos = todosOf(U, n.body);
  const done = todos.filter((t) => t.done).length;
  const text = U.plain(n.body || n.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const body = todos.length
    ? h('div', { class: 'todo-preview' }, todos.slice(0, todoMax).map((t) => h('div', { class: 'ln', 'data-k': 'todo', 'data-c': t.done ? '1' : null, style: t.ind ? { '--ind': t.ind } : null, text: t.text || ' ' })))
    : text ? h('p', { class: `l${lines}`, text }) : null;
  return h('button', { class: `card hover note-card ${active ? 'active' : ''}`, style: { '--c': c ? c.color : 'var(--border2)' }, onclick, 'data-id': n.id },
    h('i', { class: 'edge' }),
    h('b', { class: 'ttl' }, h('span', { class: 'grow', text: n.title || 'Untitled' }), n.pinned ? icon('pin', 'pin') : null),
    body,
    h('small', { class: 'meta' },
      showCourse ? h('i', { class: 'dot' }) : null,
      showCourse ? h('em', { text: c ? c.name : 'No course' }) : null,
      showCourse ? h('span', { class: 'faint', text: '·' }) : null,
      h('span', { text: when }),
      todos.length ? [h('span', { class: 'faint', text: '·' }), h('span', { text: `${done}/${todos.length} done` })] : null,
      todos.length > todoMax ? h('span', { class: 'faint', text: `· ${todos.length - todoMax} more` }) : null));
}

// The rail's timeline: time, a node in the course colour, title and detail; the next one counts down.
export function timeline(items) {
  return h('div', { class: 'tl' }, items.map((it) => h(it.onclick ? 'button' : 'div', { class: `it ${it.next ? 'next' : ''} ${it.dim ? 'dim' : ''}`, style: { '--c': it.color || 'var(--muted)' }, onclick: it.onclick },
    h('span', { class: 't tnum', text: it.time }),
    h('i', { class: 'n' }),
    h('span', { class: 'b' }, h('span', { class: 'h ellipsis', text: it.title }), it.sub ? h('span', { class: 'm ellipsis', text: it.sub }) : null),
    it.chip || h('span'))));
}
