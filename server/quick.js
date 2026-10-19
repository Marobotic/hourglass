// The assistant's fast lane: requests common enough to answer without a model.
// "Set an alarm in 30 minutes", "wake me up at 8 PM EST", "25 minute timer",
// "when is Sara's birthday", "what's on today" are understood here and done at
// once (well under a second), where a model run takes 6-20 s. Anything this
// isn't sure about returns null and goes to the model, so a guess never
// replaces a real answer: every pattern is anchored to the whole message, and
// a message with words left over that aren't understood is passed on.
import { WEEKDAYS, addDays, localParts, weekday, zonedToEpoch } from "../core/dates.js";
import { alarmCard, dayCard, eventCard } from "./cards.js";

const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// What people write after a time. Eastern/Pacific/... follow daylight saving,
// which is what "8 PM EST" means in October too.
const ZONES = {
  est: "America/New_York", edt: "America/New_York", et: "America/New_York", eastern: "America/New_York",
  cst: "America/Chicago", cdt: "America/Chicago", ct: "America/Chicago", central: "America/Chicago",
  mst: "America/Denver", mdt: "America/Denver", mt: "America/Denver", mountain: "America/Denver",
  pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pt: "America/Los_Angeles", pacific: "America/Los_Angeles",
  gmt: "UTC", utc: "UTC", bst: "Europe/London", uk: "Europe/London", london: "Europe/London",
  cet: "Europe/Paris", cest: "Europe/Paris", eet: "Africa/Cairo", eest: "Africa/Cairo", egypt: "Africa/Cairo", cairo: "Africa/Cairo",
  ist: "Asia/Kolkata", jst: "Asia/Tokyo", aest: "Australia/Sydney", gst: "Asia/Dubai", dubai: "Asia/Dubai",
};

const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, fifty: 50, sixty: 60, ninety: 90 };
const NUM = String.raw`(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty-five|fifty|sixty|ninety)`;
const UNIT = String.raw`(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])`;
const DURATION = String.raw`(?:half an hour|an hour and a half|${NUM}\s*${UNIT}(?:\s*(?:and\s+)?${NUM}\s*${UNIT})*(?:\s+and a half)?)`;

const num = (w) => (w in WORD_NUM ? WORD_NUM[w] : Number(w));

/** "1h 30m", "90 minutes", "half an hour" -> seconds, or null. */
export function parseDuration(s) {
  s = s.trim().toLowerCase();
  if (s === "half an hour") return 1800;
  if (s === "an hour and a half") return 5400;
  let total = 0;
  let any = false;
  const re = new RegExp(String.raw`(${NUM})\s*(${UNIT})`, "g");
  let m;
  let unitSecs = 0;
  while ((m = re.exec(s))) {
    any = true;
    const u = m[2][0];
    unitSecs = u === "h" ? 3600 : u === "m" ? 60 : 1;
    total += num(m[1]) * unitSecs;
  }
  if (!any) return null;
  if (/and a half$/.test(s)) total += unitSecs / 2;
  return Math.round(total) || null;
}

/** "8", "8pm", "8:30 am", "20:30", "noon" -> { minutes, ampm }, or null. */
export function parseClock(s) {
  s = s.trim().toLowerCase().replace(/\./g, ":").replace(/\s+/g, " ");
  if (s === "noon" || s === "midday") return { minutes: 720, ampm: true };
  if (s === "midnight") return { minutes: 0, ampm: true };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m|in the morning|in the evening|at night|tonight|o'?clock)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59 || h > 23) return null;
  const tag = (m[3] || "").replace(/ /g, "");
  const pm = /^(pm|intheevening|atnight|tonight)$/.test(tag);
  const am = /^(am|inthemorning)$/.test(tag);
  if ((pm || am) && (h < 1 || h > 12)) return null;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return { minutes: h * 60 + min, ampm: pm || am || h > 12 || h === 0 || !!m[2] && h >= 13 };
}

const fmtClock = (minutes, h12) => {
  const h = Math.floor(minutes / 60) % 24;
  const m = String(minutes % 60).padStart(2, "0");
  if (!h12) return `${String(h).padStart(2, "0")}:${m}`;
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d) => `${WEEKDAYS[weekday(d) - 1]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

function dayWord(date, today) {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  return fmtDate(date);
}

function clean(text) {
  return String(text)
    .trim()
    .replace(/[’‘]/g, "'")
    .replace(/[?!.。]+$/, "")
    .replace(/^(?:hey|hi|ok|okay)[,\s]+/i, "")
    .replace(/^(?:(?:can|could|would|will) you\s+(?:please\s+)?|please\s+|i want you to\s+|i need you to\s+|i'd like you to\s+)/i, "")
    .replace(/\s+please$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- when: a clock time with a day and a zone, or "in <duration>" ------------------

/**
 * The rest of an alarm request: "8 pm est tomorrow", "in 30 minutes",
 * "7:15 on weekdays called gym". Returns null when anything is left that
 * isn't understood.
 */
function parseWhen(rest, { tz, now, wake }) {
  let s = ` ${rest.toLowerCase()} `;
  const out = { label: null, days: null, date: null, zone: null, clock: null, inSecs: null };

  // A label: "called gym", "labelled meds", "to take my pills", "for the gym" (after the time).
  // The first marker whose words aren't a time or a day ("for 6:30 am called gym": "gym").
  for (const lab of s.matchAll(/\s(?:called|named|labell?ed|saying|that says|with the label|to|for)\s+/g)) {
    const words = s.slice(lab.index + lab[0].length).trim().replace(/^["']|["']$/g, "");
    if (!words || /^(?:\d|tomorrow|today|tonight|in\s|at\s|on\s|every|noon|midnight|weekdays|weekends)/.test(words)) continue;
    out.label = words;
    s = s.slice(0, lab.index) + " ";
    break;
  }

  const dur = new RegExp(String.raw`\s(?:in|after)\s+(${DURATION})(?:\s+from now)?\s`).exec(s);
  if (dur) {
    out.inSecs = parseDuration(dur[1]);
    s = s.replace(dur[0], " ");
  }

  const zre = new RegExp(String.raw`\s(?:in\s+)?(${Object.keys(ZONES).join("|")})(?:\s+time)?\s`);
  const z = zre.exec(s);
  if (z) {
    out.zone = ZONES[z[1]];
    s = s.replace(z[0], " ");
  }

  if (/\s(?:every\s?day|daily|each day)\s/.test(s)) { out.days = [1, 2, 3, 4, 5, 6, 7]; s = s.replace(/\s(?:every\s?day|daily|each day)\s/, " "); }
  else if (/\s(?:on\s+|every\s+)?weekdays\s/.test(s)) { out.days = [1, 2, 3, 4, 5]; s = s.replace(/\s(?:on\s+|every\s+)?weekdays\s/, " "); }
  else if (/\s(?:on\s+|every\s+)?weekends\s/.test(s)) { out.days = [6, 7]; s = s.replace(/\s(?:on\s+|every\s+)?weekends\s/, " "); }
  else {
    const every = new RegExp(String.raw`\s(?:every|on)\s+((?:(?:${DAY_NAMES.join("|")})s?(?:\s*,\s*|\s+and\s+|\s+))+)`).exec(s + " ");
    if (every && /every|s\s*$|and|,/.test(every[0])) {
      const days = [...every[1].matchAll(new RegExp(DAY_NAMES.join("|"), "g"))].map((m) => DAY_NAMES.indexOf(m[0]) + 1);
      if (days.length && (/every/.test(every[0]) || days.length > 1 || /days?\s*$/.test(every[1].trim()) || /s$/.test(every[1].trim()))) {
        out.days = [...new Set(days)].sort();
        s = s.replace(every[0], " ");
      }
    }
  }

  const today = localParts(now, tz).date;
  if (!out.days) {
    if (/\s(?:tomorrow|tmrw|tmr)(?:\s+(?:morning|evening|night))?\s/.test(s)) {
      out.date = "+1";
      if (/tomorrow\s+morning/.test(s)) out.morning = true;
      if (/tomorrow\s+(?:evening|night)/.test(s)) out.evening = true;
      s = s.replace(/\s(?:tomorrow|tmrw|tmr)(?:\s+(?:morning|evening|night))?\s/, " ");
    } else if (/\stoday\s/.test(s)) { out.date = "+0"; s = s.replace(/\stoday\s/, " "); }
    else if (/\stonight\s/.test(s)) { out.date = "+0"; out.evening = true; s = s.replace(/\stonight\s/, " "); }
    else if (/\sthis\s+(?:morning)\s/.test(s)) { out.date = "+0"; out.morning = true; s = s.replace(/\sthis\s+morning\s/, " "); }
    else if (/\sthis\s+(?:evening|afternoon)\s/.test(s)) { out.date = "+0"; out.evening = true; s = s.replace(/\sthis\s+(?:evening|afternoon)\s/, " "); }
    else {
      const wd = new RegExp(String.raw`\s(?:on\s+|this\s+|next\s+)?(${DAY_NAMES.join("|")})\s`).exec(s);
      if (wd) {
        const target = DAY_NAMES.indexOf(wd[1]) + 1;
        let d = addDays(today, 1);
        while (weekday(d) !== target) d = addDays(d, 1);
        out.date = d;
        s = s.replace(wd[0], " ");
      }
      const md = new RegExp(String.raw`\s(?:on\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH_NAMES.map((m) => m.slice(0, 3) + "[a-z]*").join("|")})|(${MONTH_NAMES.map((m) => m.slice(0, 3) + "[a-z]*").join("|")})\s+(\d{1,2})(?:st|nd|rd|th)?)\s`).exec(s);
      if (md && !out.date) {
        const day = Number(md[1] || md[4]);
        const mon = MONTH_NAMES.findIndex((m) => (md[2] || md[3]).startsWith(m.slice(0, 3))) + 1;
        let year = Number(today.slice(0, 4));
        let d = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (d < today) d = `${year + 1}${d.slice(4)}`;
        out.date = d;
        s = s.replace(md[0], " ");
      }
      const iso = /\s(?:on\s+)?(\d{4}-\d{2}-\d{2})\s/.exec(s);
      if (iso && !out.date) { out.date = iso[1]; s = s.replace(iso[0], " "); }
    }
  }

  const clockRe = /\s(?:at\s+|for\s+|by\s+)?(noon|midday|midnight|\d{1,2}(?:[:.]\d{2})?(?:\s*(?:a\s?m|p\s?m|in the morning|in the evening|at night|o'?clock))?)\s/;
  const c = clockRe.exec(s);
  if (c) {
    out.clock = parseClock(c[1]);
    if (!out.clock) return null;
    s = s.replace(c[0], " ");
  }

  // Whatever is left must be filler.
  const left = s.replace(/\b(?:at|on|for|the|a|an|me|up|please|alarm|set|in|from|now|my|and|every|this|o'?clock)\b/g, " ").trim();
  if (left) return null;
  if (!out.clock && !out.inSecs) return null;
  if (out.clock && out.inSecs) return null;
  return finishWhen(out, { tz, now, wake, today });
}

// Turn the parts into the alarm: { date, time } in the app's zone (or days for a repeating one).
function finishWhen(w, { tz, now, wake, today }) {
  if (w.inSecs) {
    if (w.days || w.date) return null;
    const at = now + w.inSecs * 1000;
    // Alarms ring on the minute: the nearest one.
    const p = localParts(Math.round(at / 60000) * 60000, tz);
    return { date: p.date, time: p.time, label: w.label, at: Math.round(at / 60000) * 60000, relative: w.inSecs };
  }
  const zone = w.zone || tz;
  let minutes = w.clock.minutes;
  const ambiguous = !w.clock.ampm && minutes < 13 * 60 && minutes >= 60;
  const zToday = localParts(now, zone).date;
  const pick = (date) => {
    let cands = [minutes];
    if (ambiguous) {
      // "wake me at 7" means the morning; "evening/tonight" means pm; otherwise the next one.
      if (w.evening) cands = [minutes % 720 + 720];
      else if (wake || w.morning) cands = [minutes % 720];
      else cands = [minutes % 720, minutes % 720 + 720];
    }
    const opts = cands.map((m) => zonedToEpoch(date, fmtClock(m, false), zone)).filter((t) => t > now);
    return opts.length ? Math.min(...opts) : null;
  };
  if (w.days) {
    // A repeating alarm is stored in the app's zone: convert the clock time.
    const m = ambiguous && !w.evening ? minutes % 720 : ambiguous ? minutes % 720 + 720 : minutes;
    const at = zonedToEpoch(zToday, fmtClock(m, false), zone);
    const p = localParts(at, tz);
    return { days: w.days, time: p.time, label: w.label, at: null, zone: w.zone };
  }
  let date;
  if (w.date === "+0") date = zToday;
  else if (w.date === "+1") date = addDays(zToday, 1);
  else date = w.date;
  let at = null;
  if (date) at = pick(date);
  else at = pick(zToday) ?? pick(addDays(zToday, 1));
  if (at === null) return null; // a time already gone today, asked for today
  const p = localParts(at, tz);
  return { date: p.date, time: p.time, label: w.label, at, zone: w.zone };
}

// --- the requests ---------------------------------------------------------------------

function alarmRequest(t, raw) {
  const s = clean(raw).toLowerCase();
  let m;
  let rest = null;
  let wake = false;
  let label = null;
  if ((m = /^(?:set|setup|set up|make|create|add|put|schedule|start)?\s*(?:me\s+)?(?:an?\s+|my\s+|the\s+)?(?:new\s+)?alarm(?:\s+clock)?\s*(.*)$/.exec(s))) rest = m[1];
  else if ((m = /^wake\s+me(?:\s+up)?\s+(.+)$/.exec(s))) { rest = m[1]; wake = true; label = "Wake up"; }
  else if ((m = /^(?:remind me|ping me)\s+(.+?)\s+(?:to|about)\s+(.+)$/.exec(s)) && /^(?:at|on|tomorrow|tonight|today)\b/.test(m[1])) { rest = m[1]; label = m[2]; }
  if (rest === null || !rest.trim()) return null;
  const w = parseWhen(rest, { tz: t.tz, now: t.clock(), wake });
  if (!w) return null;
  const finalLabel = cap(w.label || label || "Alarm");
  const row = t.setAlarm({ label: finalLabel, time: w.time, date: w.days ? undefined : w.date, days: w.days || undefined });
  const h12 = t.settings().time_format !== "24h";
  const clock = (hhmm) => fmtClock(Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), h12);
  const today = t.today();
  let text;
  if (w.days) {
    const days = w.days.length === 7 ? "every day" : w.days.join() === "1,2,3,4,5" ? "on weekdays" : w.days.join() === "6,7" ? "on weekends" : "every " + w.days.map((d) => WEEKDAYS[d - 1]).join(", ");
    text = `Alarm set for ${clock(w.time)} ${days}.`;
  } else {
    text = `Alarm set for ${clock(w.time)} ${dayWord(w.date, today)}${w.relative ? ` (in ${spell(w.relative)})` : ""}.`;
  }
  if (w.zone && w.zone !== t.tz) {
    const there = localParts(w.at ?? Date.now(), w.zone);
    text += ` That's ${clock(there.time)} in ${city(w.zone)}; your app runs on ${city(t.tz)} time.`;
  }
  if (finalLabel !== "Alarm") text = text.replace("Alarm set", `"${finalLabel}" set`);
  return { text, tools: [{ tool: "set_alarm", status: "completed" }], ids: { alarm_id: row.id }, cards: [alarmCard(t, row, "set")] };
}

function timerRequest(t, raw) {
  const s = clean(raw).toLowerCase();
  const D = DURATION;
  let m;
  let secs = null;
  let label = null;
  const tail = String.raw`(?:\s+(?:called|named|labell?ed|for|to)\s+(.+))?`;
  if ((m = new RegExp(String.raw`^(?:set|start|make|create|run|put on|begin)?\s*(?:me\s+)?(?:an?\s+|the\s+)?(${D})\s+(?:long\s+)?(?:timer|countdown)${tail}$`).exec(s))) { secs = parseDuration(m[1]); label = m[2]; }
  else if ((m = new RegExp(String.raw`^(?:set|start|make|create|run|begin)?\s*(?:me\s+)?(?:an?\s+|the\s+)?(?:timer|countdown)\s+(?:for\s+|of\s+)?(${D})${tail}$`).exec(s))) { secs = parseDuration(m[1]); label = m[2]; }
  else if ((m = new RegExp(String.raw`^(?:remind|ping|tell) me in\s+(${D})(?:\s+(?:to|about|that)\s+(.+))?$`).exec(s))) { secs = parseDuration(m[1]); label = m[2] || "Reminder"; }
  else if ((m = new RegExp(String.raw`^time\s+(${D})$`).exec(s))) secs = parseDuration(m[1]);
  if (!secs || secs > 7 * 86400) return null;
  if (label && new RegExp(String.raw`^${D}$`).test(label)) return null;
  const row = t.startTimer({ seconds: secs, label: label ? cap(label) : undefined });
  const h12 = t.settings().time_format !== "24h";
  const end = localParts(row.ends_at, t.tz);
  return {
    text: `${label ? `"${cap(label)}" timer` : "Timer"} started for ${spell(secs)}. It rings at ${fmtClock(Number(end.time.slice(0, 2)) * 60 + Number(end.time.slice(3)), h12)}.`,
    tools: [{ tool: "start_timer", status: "completed" }],
    ids: { timer_id: row.id },
    cards: [{ kind: "timer", state: "running", label: row.label, ends_at: row.ends_at, duration_s: row.duration_s }],
  };
}

// "When is Sara's birthday?" The calendar first; notes only if it isn't there.
function lookupRequest(t, raw) {
  const s = clean(raw).toLowerCase();
  let m;
  let name = null;
  let what = null;
  if ((m = /^(?:when(?:'s| is| was)|what(?:'s| is)|what day is|what date is|tell me)\s+(?:the\s+)?(.+?)(?:'s|s')?\s+(birthday|bday|b-day|anniversary)$/.exec(s))) { name = m[1]; what = m[2].startsWith("b") ? "birthday" : "anniversary"; }
  else if ((m = /^(?:when(?:'s| is| was)|what day is|what date is)\s+(?:the\s+)?(birthday|bday|anniversary) of\s+(.+)$/.exec(s))) { name = m[2]; what = m[1].startsWith("b") ? "birthday" : "anniversary"; }
  else if ((m = /^(?:when(?:'s| is)|what day is|what date is)\s+(?:my\s+|the\s+)(.+)$/.exec(s)) && !/\b(?:next|first|last|now|today|tomorrow|class|lecture|alarm|timer|lesson)\b/.test(m[1])) { name = m[1]; }
  if (!name) return null;
  name = name.replace(/^(?:my|the)\s+/, "").replace(/'s$/, "").trim();
  if (!name || name.split(" ").length > 4) return null;
  const query = what ? `${name} ${what}` : name;
  let found = t.findEvents({ query, limit: 5 }).events.filter((e) => e.next);
  // "Sara's bday", or just "Sara" repeating every year.
  if (!found.length && what) {
    const re = what === "birthday" ? /birth|bday|b-day|born/i : /anniv/i;
    found = t.findEvents({ query: name, limit: 5 }).events.filter((e) => e.next && (re.test(e.title) || e.repeats.startsWith("yearly")));
  }
  const h12 = t.settings().time_format !== "24h";
  const today = t.today();
  const tools = [{ tool: "find_events", status: "completed" }];
  if (found.length) {
    const lines = found.slice(0, 3).map((e) => {
      const allDay = e.next.start_time === "00:00" && (e.next.end_time === "23:59" || e.next.end_time === "00:00");
      const when = `${dayWord(e.next.date, today)}${e.next.date !== today && e.next.date !== addDays(today, 1) ? ` ${e.next.date.slice(0, 4)}` : ""}`;
      const until = Math.round((Date.parse(e.next.date) - Date.parse(today)) / 864e5);
      return `${e.title}: ${when}${allDay ? "" : `, ${fmtClock(Number(e.next.start_time.slice(0, 2)) * 60 + Number(e.next.start_time.slice(3)), h12)}`}${until > 1 ? ` (in ${until} days)` : ""}${e.repeats && e.repeats !== "once" ? `, ${e.repeats}` : ""}.`;
    });
    return { text: lines.join("\n"), tools, cards: found.slice(0, 3).map((e) => eventCard(t, e, "found")) };
  }
  if (!what) return null; // "when is my X" with no event: the model may know better
  tools.push({ tool: "search_notes", status: "completed" });
  const notes = t.searchNotes({ query: name, limit: 3 }).filter((n) => new RegExp(what === "birthday" ? "birth|bday|born" : "anniv", "i").test(n.snippet + " " + n.title));
  if (notes.length) {
    const n = notes[0];
    return { text: `It isn't in your calendar, but your note "${n.title}" says: …${n.snippet.trim().replace(/\s+/g, " ")}…`, tools };
  }
  return { text: `I couldn't find ${cap(name)}'s ${what} in your calendar or your notes. Tell me the date and I'll add it as a yearly event.`, tools };
}

function scheduleRequest(t, raw) {
  const s = clean(raw).toLowerCase();
  const h12 = t.settings().time_format !== "24h";
  const clock = (hhmm) => fmtClock(Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), h12);
  let day = null;
  if (/^(?:what(?:'s| is| do i have)|whats|anything)\s+(?:on\s+)?(?:for\s+)?today(?:\s+for me)?$|^what do i have(?: on)? today$|^(?:what's|what is) my (?:schedule|day) (?:for )?today$|^today$/.test(s)) day = 0;
  else if (/^(?:what(?:'s| is| do i have)|whats|anything)\s+(?:on\s+)?(?:for\s+)?tomorrow$|^what do i have(?: on)? tomorrow$|^(?:what's|what is) my (?:schedule|day) (?:for )?tomorrow$/.test(s)) day = 1;
  else if (/^(?:what(?:'s| is)\s+(?:on\s+)?(?:now|next)|what's happening now|what is happening now|(?:what(?:'s| is)|when(?:'s| is)) my next (?:class|lecture|event|lesson|session)|what(?:'s| is) next)$/.test(s)) day = "now";
  if (day === null) return null;
  if (day === "now") {
    const n = t.whatsNow();
    const parts = [];
    if (n.active) parts.push(`Now: ${n.active.title}${n.active.location ? ` in ${n.active.location}` : ""}, until ${clock(n.active.end_time)}.`);
    if (n.next) parts.push(`Next: ${n.next.title} at ${clock(n.next.start_time)}${n.next.date && n.next.date !== t.today() ? ` ${dayWord(n.next.date, t.today())}` : ""}${n.next.location ? ` in ${n.next.location}` : ""}.`);
    if (!parts.length) parts.push("Nothing on now, and nothing in the next 12 hours.");
    return { text: parts.join(" "), tools: [{ tool: "whats_now", status: "completed" }], cards: n.active || n.next?.date === t.today() ? [dayCard(t, t.today(), "today")] : [] };
  }
  const date = addDays(t.today(), day);
  const occ = t.schedule({ from: date, to: date }).occurrences.filter((o) => o.mark !== "off");
  const word = day === 0 ? "today" : "tomorrow";
  if (!occ.length) return { text: `Nothing in your calendar ${word}.`, tools: [{ tool: "get_schedule", status: "completed" }] };
  const lines = occ.map((o) => `${clock(o.start_time)}-${clock(o.end_time)} ${o.title}${o.location ? ` (${o.location})` : ""}`);
  return { text: `${cap(word)}:\n${lines.join("\n")}`, tools: [{ tool: "get_schedule", status: "completed" }], cards: [dayCard(t, date, word)] };
}

function alarmsRequest(t, raw) {
  const s = clean(raw).toLowerCase();
  if (!/^(?:what|which|show|list|show me)\s+(?:are\s+)?(?:all\s+)?(?:my\s+)?alarms(?:\s+(?:do i have|are set|i have))?$|^(?:do i have any|what) alarms(?: set| do i have)?$/.test(s)) return null;
  const h12 = t.settings().time_format !== "24h";
  const list = t.listAlarms().filter((a) => a.next_at && a.enabled).slice(0, 8);
  if (!list.length) return { text: "No alarms are set.", tools: [{ tool: "list_alarms", status: "completed" }] };
  const today = t.today();
  const lines = list.map((a) => {
    const p = localParts(a.next_at, t.tz);
    return `${a.label}: ${fmtClock(Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3)), h12)} ${dayWord(p.date, today)}${a.days?.length ? " (repeats)" : ""}`;
  });
  return { text: lines.join("\n"), tools: [{ tool: "list_alarms", status: "completed" }], cards: list.slice(0, 4).map((a) => alarmCard(t, a, "on")) };
}

// "Cancel my alarm", "turn off the 7am alarm", "delete the gym alarm", "turn off all alarms".
// One clear match is acted on; anything unclear goes to the model.
function cancelAlarmRequest(t, raw) {
  const s = clean(raw).toLowerCase();
  const m = /^(cancel|delete|remove|clear|turn off|switch off|disable|stop|turn on|switch on|enable)\s+(?:all\s+(?:of\s+)?(?:my\s+|the\s+)?|my\s+|the\s+|that\s+)?(?:(.+?)\s+)?alarms?(?:\s+(?:for|at)\s+(.+))?$/.exec(s);
  if (!m) return null;
  const verb = m[1];
  const on = /^(?:turn on|switch on|enable)$/.test(verb);
  const off = /^(?:turn off|switch off|disable|stop)$/.test(verb);
  const all = /^(?:\S+\s+)?all\b/.test(s.slice(verb.length).trim());
  const target = (m[2] || m[3] || "").replace(/^(?:my|the)\s+/, "").trim();
  const list = t.listAlarms();
  const lecture = (a) => !!(a.lead_event_id || a.lead_course_id);
  const h12 = t.settings().time_format !== "24h";
  const tools = [{ tool: on || off ? "set_alarms_enabled" : "remove_alarm", status: "completed" }];
  if (all && !target) {
    if (!on && !off) return null; // deleting every alarm: let the model confirm
    const pick = list.filter((a) => !!a.enabled !== on);
    for (const a of pick) t.setAlarm({ alarm_id: a.id, enabled: on });
    return { text: pick.length ? `Turned ${on ? "on" : "off"} ${pick.length} alarm${pick.length > 1 ? "s" : ""}.` : `All your alarms are already ${on ? "on" : "off"}.`, tools, cards: pick.slice(0, 4).map((a) => alarmCard(t, a, on ? "on" : "off")) };
  }
  let cands;
  if (!target) cands = list.filter((a) => (on ? !a.enabled : a.enabled) && !lecture(a) && a.next_at !== null);
  else {
    const c = parseClock(target.replace(/^(?:at|for)\s+/, ""));
    if (c) cands = list.filter((a) => a.time && (Number(a.time.slice(0, 2)) * 60 + Number(a.time.slice(3))) % (c.ampm ? 1440 : 720) === c.minutes % (c.ampm ? 1440 : 720));
    else {
      const words = target.split(/\s+/).filter((w) => w.length > 1);
      cands = list.filter((a) => words.every((w) => a.label.toLowerCase().includes(w)));
    }
  }
  if (cands.length !== 1) return null;
  const a = cands[0];
  const card = alarmCard(t, a, "set");
  const name = a.label && a.label !== "Alarm" ? `"${a.label}"` : `the ${card.time} alarm`;
  if (on || off) {
    t.setAlarm({ alarm_id: a.id, enabled: on });
    return { text: `Turned ${on ? "on" : "off"} ${name}.`, tools, cards: [alarmCard(t, a, on ? "on" : "off")] };
  }
  t.removeAlarm({ alarm_id: a.id });
  return { text: `Removed ${name}${card.when ? ` (${card.when})` : ""}.`, tools, cards: [{ ...card, state: "removed", enabled: false }] };
}

// "Stop the timer", "cancel all timers", "stop the tea timer".
function stopTimerRequest(t, raw) {
  const s = clean(raw).toLowerCase();
  const m = /^(?:stop|cancel|end|kill|clear|reset|delete|remove)\s+(?:all\s+(?:of\s+)?(?:my\s+|the\s+)?|my\s+|the\s+|that\s+)?(?:(.+?)\s+)?timers?$/.exec(s);
  if (!m) return null;
  const all = /\ball\b/.test(s);
  const running = t.listTimers().filter((x) => x.state === "running" || x.state === "paused");
  const target = (m[1] || "").trim();
  const pick = all ? running : target ? running.filter((x) => x.label.toLowerCase().includes(target)) : running;
  if (!pick.length) return { text: "No timer is running.", tools: [{ tool: "list_timers", status: "completed" }] };
  if (!all && pick.length > 1) return null;
  for (const x of pick) t.updateTimer({ timer_id: x.id, action: "reset" });
  return {
    text: pick.length === 1 ? `Stopped "${pick[0].label}".` : `Stopped ${pick.length} timers.`,
    tools: [{ tool: "stop_timers", status: "completed" }],
    cards: pick.slice(0, 4).map((x) => ({ kind: "timer", state: "stopped", label: x.label, ends_at: null, duration_s: x.duration_s ?? 0 })),
  };
}

const MON_RE = MONTH_NAMES.map((m) => m.slice(0, 3) + "[a-z]*").join("|");
/** "5 march", "march 5th", "5th of march", "2001-03-05" -> "MM-DD" or "YYYY-MM-DD". */
function parseDayMonth(s) {
  s = s.trim().toLowerCase().replace(/,/g, "");
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = new RegExp(String.raw`^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MON_RE})(?:\s+(\d{4}))?$`).exec(s) || new RegExp(String.raw`^(${MON_RE})\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$`).exec(s);
  if (!m) return null;
  const [day, mon, year] = /^\d/.test(m[1]) ? [m[1], m[2], m[3]] : [m[2], m[1], m[3]];
  const mi = MONTH_NAMES.findIndex((x) => mon.startsWith(x.slice(0, 3))) + 1;
  const d = Number(day);
  if (!mi || d < 1 || d > 31) return null;
  const md = `${String(mi).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return year ? `${year}-${md}` : md;
}

// "Add Sara's birthday on 5 March", "Sara's birthday is March 5", "remember Omar's bday 3 june".
function addBirthdayRequest(t, raw) {
  const s = clean(raw).toLowerCase();
  const m = /^(?:add|save|remember|put|note|set)?\s*(?:that\s+)?(.+?)(?:'s|s'|s)\s+(?:birthday|bday|b-day)\s+(?:is\s+)?(?:on\s+)?(.+)$/.exec(s)
    || /^(?:add|save|remember)\s+(?:a\s+)?(?:birthday|bday)\s+(?:for\s+)(.+?)\s+(?:on\s+)?(.+)$/.exec(s);
  if (!m) return null;
  const name = m[1].replace(/^(?:my|the)\s+/, "").trim();
  if (!name || name.split(" ").length > 3) return null;
  const date = parseDayMonth(m[2]);
  if (!date) return null;
  const today = t.today();
  const start = date.length === 5 ? `${today.slice(0, 4)}-${date}` : date;
  const nice = name.replace(/\b\w/g, (c) => c.toUpperCase());
  const row = t.addEvent({ title: `${nice}'s birthday`, kind: "event", date: start, start: "00:00", end: "23:59", repeat: { freq: "yearly" } });
  const ev = t.findEvents({ limit: 500 }).events.find((e) => e.event_id === row.id);
  const card = eventCard(t, ev || { title: row.title, date: start, start_time: "00:00", end_time: "23:59" }, "added");
  return { text: `Added ${nice}'s birthday: every year on ${card.when.replace(/^\w+ /, "").replace(/ \d{4}$/, "")}${card.days_until > 1 ? `, next in ${card.days_until} days` : ""}.`, tools: [{ tool: "add_birthday", status: "completed" }], cards: [card] };
}

// "Upcoming birthdays", "who's birthday is next", "any birthdays coming up".
function upcomingRequest(t, raw) {
  const s = clean(raw).toLowerCase();
  const birthdays = /birthday|bday/.test(s);
  if (!/^(?:upcoming|next|coming)\s+(?:birthdays|bdays|events)$|^(?:what|which|any)\s+(?:birthdays|bdays|events)\s+(?:are\s+|do i have\s+)?(?:coming up|soon|this month|next)$|^who(?:'s|se|s| has| is having) (?:a |the next )?birthday(?: is)?(?: next| soon| coming up)?$|^(?:show|list) (?:my )?(?:upcoming )?birthdays$/.test(s)) return null;
  const today = t.today();
  const evs = t.findEvents({ personal: true, limit: 500 }).events
    .filter((e) => e.next && (!birthdays || /birth|bday|b-day/i.test(e.title)))
    .map((e) => ({ ...e, days: Math.round((Date.parse(e.next.date) - Date.parse(today)) / 864e5) }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 4);
  const tools = [{ tool: "upcoming_events", status: "completed" }];
  if (!evs.length) return { text: birthdays ? "No birthdays in your calendar yet. Tell me one, like \"Sara's birthday is 5 March\"." : "Nothing coming up in your calendar.", tools };
  return { text: evs.map((e) => `${e.title}: ${dayWord(e.next.date, today)}${e.days > 1 ? ` (in ${e.days} days)` : ""}`).join("\n"), tools, cards: evs.map((e) => eventCard(t, e, "found")) };
}

// "How long until Sara's birthday", "how many days till my exam".
function howLongRequest(t, raw) {
  const s = clean(raw).toLowerCase();
  const m = /^how (?:long|many days|much time) (?:is it )?(?:until|till|til|to|before) (?:my |the )?(.+)$/.exec(s);
  if (!m) return null;
  const q = m[1].replace(/(?:'s|s')\s+(birthday|bday)/, " $1").trim();
  const found = t.findEvents({ query: q, limit: 5 }).events.filter((e) => e.next);
  if (found.length !== 1) return null;
  const e = found[0];
  const days = Math.round((Date.parse(e.next.date) - Date.parse(t.today())) / 864e5);
  return { text: days === 0 ? `${e.title} is today.` : days === 1 ? `${e.title} is tomorrow.` : `${days} days until ${e.title} (${dayWord(e.next.date, t.today())}).`, tools: [{ tool: "find_events", status: "completed" }], cards: [eventCard(t, e, "found")] };
}

// "Remind me to call mom at 9pm" (an alarm called "Call mom"), "remind me to stretch in 20 minutes" (a timer).
function remindRequest(t, raw) {
  const s = clean(raw);
  const m = /^(?:remind|ping) me to\s+(.+?)\s+((?:at|in|on|tomorrow|tonight|today|this)\b.*)$/i.exec(s);
  if (!m) return null;
  const what = m[1];
  const when = m[2];
  if (/^in\s/i.test(when)) return timerRequest(t, `remind me in ${when.replace(/^in\s+/i, "")} to ${what}`);
  return alarmRequest(t, `set an alarm ${when} called ${what}`);
}

// "Sara birthday", "sara's bday": a bare lookup.
function bareBirthdayRequest(t, raw) {
  const s = clean(raw).toLowerCase();
  const m = /^([a-z][a-z .'-]{0,30}?)(?:'s|s')?\s+(birthday|bday|b-day)$/.exec(s);
  if (!m || /^(?:my|add|next|upcoming|any|whose|who)\b/.test(m[1])) return null;
  return lookupRequest(t, `when is ${m[1]}'s birthday`);
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const city = (z) => (z === "UTC" ? "UTC" : z.split("/").pop().replace(/_/g, " "));
function spell(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h && `${h} hour${h > 1 ? "s" : ""}`, m && `${m} minute${m > 1 ? "s" : ""}`, s && `${s} second${s > 1 ? "s" : ""}`].filter(Boolean).join(" ");
}

/**
 * A reply made here, or null for the model. `service` is the account's
 * Service. The answer: { text, tools: [{ tool, status }] }.
 */
export function quickAnswer(service, text) {
  if (!text || text.length > 160 || /\n/.test(text.trim())) return null;
  for (const f of [stopTimerRequest, cancelAlarmRequest, remindRequest, addBirthdayRequest, upcomingRequest, howLongRequest, timerRequest, alarmRequest, lookupRequest, bareBirthdayRequest, scheduleRequest, alarmsRequest]) {
    try {
      const r = f(service, text);
      if (r) return r;
    } catch {
      // A tool said no (a bad time, a missing course): the model can explain it better.
      return null;
    }
  }
  return null;
}
