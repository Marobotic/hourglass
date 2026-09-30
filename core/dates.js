// Calendar dates are "YYYY-MM-DD" strings and times are "HH:MM" wall-clock
// strings in the user's zone. Day arithmetic runs on UTC midnights so it never
// drifts across daylight saving.

const DAY = 86400000;

export const pad = (n) => String(n).padStart(2, "0");

export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) throw new Error(`bad date: ${s}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

export const formatDate = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const addDays = (date, n) => formatDate(parseDate(date) + n * DAY);

export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY);

// ISO weekday: 1 = Monday ... 7 = Sunday.
export const weekday = (date) => ((new Date(parseDate(date)).getUTCDay() + 6) % 7) + 1;

// Monday of the week containing date.
export const weekStart = (date) => addDays(date, 1 - weekday(date));

export function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? "");
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`bad time: ${s}`);
  return +m[1] * 60 + +m[2];
}

export const formatTime = (minutes) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
export const isTime = (s) => /^\d{1,2}:\d{2}$/.test(s ?? "");

const fmtCache = new Map();
function partsFormatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(
      tz,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
  }
  return fmtCache.get(tz);
}

// Wall-clock view of an instant in a zone.
export function localParts(ms, tz) {
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const minutes = +p.hour * 60 + +p.minute;
  return { date, time: formatTime(minutes), minutes, seconds: +p.second, weekday: weekday(date) };
}

// Instant for a wall-clock date and time in a zone. Resolves the zone offset
// twice so times next to a DST change land on the right side.
export function zonedToEpoch(date, time, tz) {
  const guess = parseDate(date) + parseTime(time) * 60000;
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const p = localParts(ms, tz);
    const seen = parseDate(p.date) + p.minutes * 60000 + p.seconds * 1000;
    ms += guess - seen;
  }
  return ms;
}

export const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Tue 30 Sep"
export function shortLabel(date) {
  const d = new Date(parseDate(date));
  return `${WEEKDAYS[weekday(date) - 1]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
