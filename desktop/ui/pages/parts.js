// Pieces several pages share: the note card.
import { h, icon } from '../dom.js';

// A note: pin or note icon, title, two lines of preview, and course · when. Tinted by its course.
export function noteCard(ctx, n, { today, onclick, showCourse = true } = {}) {
  const { U } = ctx;
  const c = ctx.courseById(n.course_id);
  const when = n.session_date === today ? 'Today' : n.pinned ? 'Pinned' : n.session_date ? U.shortDate(n.session_date) : U.ago(n.updated_at, ctx.state.clock);
  return h('button', { class: `card hover note-card ${c ? 'tinted' : ''}`, style: c ? { '--c': c.color } : null, onclick, 'data-id': n.id },
    h('b', { class: 'ttl' }, n.pinned ? icon('pin', 'pin') : null, h('span', { class: 'ellipsis', text: n.title || 'Untitled' })),
    n.body || n.snippet ? h('p', { text: U.preview(n.body || n.snippet) }) : null,
    h('small', {}, showCourse && c ? h('em', { text: c.name }) : null, showCourse && c ? ' · ' : null, when));
}
