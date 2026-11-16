// Dates, times and text helpers: a port of the Qt window's Util.qml, with the same rules and words.
import * as NF from './noteformat.mjs';

export const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const weekdaysLong = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const kinds = ['lecture', 'lab', 'tutorial', 'exam', 'event'];
export const palette = ['#B14242', '#D66E36', '#F0BE66', '#4A8B8B', '#7E6BAF', '#5B8C4A', '#C2587E', '#8A8A8A'];

// Set from the service's state (settings and time zone).
export const prefs = { h24: false, weekStartDay: 6, offsetMin: -new Date().getTimezoneOffset() };

export const pad = (n) => (n < 10 ? '0' + n : '' + n);

// "YYYY-MM-DD" helpers on UTC midnights (no DST drift)
export function parse(d) { const p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
export function fmt(ms) { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const addDays = (d, n) => fmt(parse(d) + n * 86400000);
export const isoWeekday = (d) => ((new Date(parse(d)).getUTCDay() + 6) % 7) + 1;
export const weekStart = (d) => addDays(d, -((isoWeekday(d) - prefs.weekStartDay + 7) % 7));
export const weekdayOf = (d) => weekdays[isoWeekday(d) - 1];
export const dayNum = (d) => new Date(parse(d)).getUTCDate();
export const monthName = (d) => months[new Date(parse(d)).getUTCMonth()];
export const shortDate = (d) => weekdays[isoWeekday(d) - 1] + ' ' + dayNum(d) + ' ' + monthName(d).slice(0, 3);
export const longDate = (d) => weekdaysLong[isoWeekday(d) - 1] + ', ' + dayNum(d) + ' ' + monthName(d);

// Accepts "20:30", "8:30 pm", "8pm", "0830"; returns "HH:MM" or "".
export function parseTime(s) {
  const m = /^\s*(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?\s*m?\.?\s*$/i.exec(s || '');
  if (!m) return '';
  let hr = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (min > 59) return '';
  if (m[3]) {
    if (hr < 1 || hr > 12) return '';
    hr = (hr % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
  } else if (hr > 23) return '';
  return pad(hr) + ':' + pad(min);
}
export function minutes(t) { const p = (parseTime(t) || '00:00').split(':'); return +p[0] * 60 + +p[1]; }
// Display a stored "HH:MM" time in the chosen format.
export function t(hhmm) {
  if (!hhmm) return '';
  const m = minutes(hhmm), hr = Math.floor(m / 60);
  if (prefs.h24) return pad(hr) + ':' + pad(m % 60);
  return ((hr + 11) % 12 + 1) + ':' + pad(m % 60) + ' ' + (hr < 12 ? 'AM' : 'PM');
}
export function range(a, b) {
  if (prefs.h24) return t(a) + ' – ' + t(b);
  const pa = minutes(a) < 720, pb = minutes(b) < 720;
  return (pa === pb ? t(a).slice(0, -3) : t(a)) + ' – ' + t(b);
}
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isTime = (s) => parseTime(s) !== '';

// Wall clock in the Hourglass time zone (sent by the service), read with getUTC*.
export const wall = (ms) => new Date(ms + prefs.offsetMin * 60000);
export function hhmmOf(ms) { const d = wall(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
export const clock = (ms) => t(hhmmOf(ms));
// The big clock: digits and, in 12-hour time, the AM/PM apart (they're drawn smaller).
export function clockParts(ms) {
  const d = wall(ms), hr = d.getUTCHours(), m = pad(d.getUTCMinutes()), s = pad(d.getUTCSeconds());
  if (prefs.h24) return { hm: pad(hr) + ':' + m, s, ap: '' };
  return { hm: ((hr + 11) % 12 + 1) + ':' + m, s, ap: hr < 12 ? 'AM' : 'PM' };
}
export const dayOf = (ms) => { const w = wall(ms); return fmt(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate())); };
export const minutesOf = (ms) => { const d = wall(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export function clockAt(ms, offMin) { const d = new Date(ms + offMin * 60000); return t(pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes())); }
export function dateAt(ms, offMin) { const d = new Date(ms + offMin * 60000); return fmt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
export function diffText(min) {
  if (!min) return 'Same time';
  const hr = Math.floor(Math.abs(min) / 60), m = Math.abs(min) % 60;
  return (min > 0 ? '+' : '−') + hr + (m ? ':' + pad(m) : '') + ' h';
}

// Back-to-back sessions of one course on one day become one block
// (lecture 8:30-9:30 + tutorial 9:30-1:30 -> 8:30-1:30). parts keeps the pieces.
export function merge(list) {
  const out = [];
  for (const o of list.slice().sort((a, b) => a.start_ms - b.start_ms)) {
    const last = out.length ? out[out.length - 1] : null;
    const gap = last ? (o.start_ms - last.end_ms) / 60000 : 999;
    if (last && last.course_id && last.course_id === o.course_id && last.date === o.date && gap >= 0 && gap <= 10) {
      last.end_time = o.end_time;
      last.end_ms = o.end_ms;
      last.parts.push(o);
    } else out.push({ ...o, parts: [o] });
  }
  return out;
}
export const markTag = (m) => (m === 'attended' ? '✓ attended' : m === 'absent' ? '✗ absent' : m === 'off' ? '– off' : '');
export const partsText = (m) => m.parts.map((p) => kindLabel(p.kind) + ' ' + t(p.start_time)).join('  ·  ');
export const lead = (teacher) => (teacher || '').split(',')[0].trim();

export function countdown(sec) {
  sec = Math.max(0, Math.round(sec));
  const hr = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (hr ? hr + ':' + pad(m) : m) + ':' + pad(s);
}
// "in 18 min", "in 3 h 5 min", "in 2 days"
export function relative(min) {
  if (min < 1) return 'now';
  if (min < 60) return 'in ' + min + ' min';
  if (min < 24 * 60) { const hr = Math.floor(min / 60), m = min % 60; return 'in ' + hr + ' h' + (m ? ' ' + m + ' min' : ''); }
  const d = Math.round(min / 1440);
  return 'in ' + d + (d === 1 ? ' day' : ' days');
}
export function left(min) {
  if (min < 60) return min + ' min left';
  const hr = Math.floor(min / 60), m = min % 60;
  return hr + ' h' + (m ? ' ' + m + ' min' : '') + ' left';
}
// "5 min ago", "yesterday", "3 Oct"
export function ago(ms, now = Date.now()) {
  const min = Math.round((now - ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  if (min < 24 * 60) return Math.floor(min / 60) + ' h ago';
  const d = dayOf(ms), today = dayOf(now);
  if (daysBetween(d, today) === 1) return 'yesterday';
  return dayNum(d) + ' ' + monthName(d).slice(0, 3) + (d.slice(0, 4) === today.slice(0, 4) ? '' : ' ' + d.slice(0, 4));
}
export function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// "Every Tue, Thu", "Daily", "Monthly on the 15th", "Yearly on 2 Nov", "... until Fri 3 Jul 2027"
export function repeatText(ev) {
  const r = ev.repeat;
  if (!r) return 'Once, ' + shortDate(ev.start_date);
  const n = r.interval > 1 ? r.interval : 0;
  const d = ev.start_date;
  let s;
  if (r.freq === 'daily') s = n ? 'Every ' + n + ' days' : 'Daily';
  else if (r.freq === 'monthly') s = (n ? 'Every ' + n + ' months' : 'Monthly') + ' on the ' + ordinal(dayNum(d));
  else if (r.freq === 'yearly') s = (n ? 'Every ' + n + ' years' : 'Yearly') + ' on ' + dayNum(d) + ' ' + monthName(d).slice(0, 3);
  else s = (n ? 'Every ' + n + ' weeks on ' : 'Every ') + (r.days || [isoWeekday(d)]).map((w) => weekdays[w - 1]).join(', ');
  if (r.until) s += ' until ' + shortDate(r.until) + (r.freq === 'monthly' || r.freq === 'yearly' ? ' ' + r.until.slice(0, 4) : '');
  return s;
}
export const kindLabel = (k) => (k ? k.charAt(0).toUpperCase() + k.slice(1) : '');

// A note's words without Markdown or font tags, for cards; and on one line, for a preview.
export const plain = (body) => NF.plainText(body || '');
export const preview = (body) => NF.plainText(body || '').replace(/\s+/g, ' ').trim().slice(0, 160);

// Numbered lists count 1, 2, 3 again after any edit (Util.qml renumber).
export function renumber(text) {
  const lines = (text || '').split('\n');
  const runs = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const indent = /^\s*/.exec(line)[0].length;
    for (const k of Object.keys(runs)) if (+k > indent) delete runs[k];
    const m = /^(\s*)(\d+)\. /.exec(line);
    if (!m) { delete runs[indent]; continue; }
    if (runs[indent] === undefined) runs[indent] = +m[2];
    const n = runs[indent]++;
    lines[i] = m[1] + n + '. ' + line.slice(m[0].length);
  }
  return lines.join('\n');
}
export const taskRe = /^(\s*)[-*] \[([ xX])\] ?(.*)$/;

export function bytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
}
export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
