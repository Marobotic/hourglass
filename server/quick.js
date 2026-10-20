// The assistant's fast lane: requests common enough to answer without a model.
// "Set an alarm in 30 minutes", "wake me up at 8 PM EST", "25 minute timer",
// "when is Sara's birthday", "what's on today" are understood here and done at
// once (well under a second), where a model run takes 6-20 s. Anything this
// isn't sure about returns null and goes to the model, so a guess never
// replaces a real answer: every pattern is anchored to the whole message, and
// a message with words left over that aren't understood is passed on.
import { WEEKDAYS, addDays, localParts, weekday, zonedToEpoch } from "../core/dates.js";
import { alarmCard, dayCard, eventCard } from "./cards.js";
import { findDay, readAnswer } from "./answer.js";

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
export function parseWhen(rest, { tz, now, wake }) {
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
        s = s.replace(every[0].trimEnd() + " ", " "); // (matched on s + " ": its last space may not be in s)
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
  // "gym alarm 7am on thursdays": the label first.
  else if ((m = /^([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3})\s+alarm\s+(.+)$/.exec(s)) && !/^(?:my|the|an?|set|setup|make|create|add|new|cancel|delete|remove|turn|move|change|what|whats|what's|when|which|any|show|list)\b/.test(m[1])) { rest = m[2]; label = m[1]; }
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
    cards: [{ kind: "timer", id: row.id, state: "running", label: row.label, ends_at: row.ends_at, duration_s: row.duration_s }],
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

// --- alarms by what people call them ---------------------------------------------------
//
// "remove my alarm that's in 1 hour", "cancel it", "delete the alarm I just set",
// "turn off tomorrow's alarm", "move my gym alarm to 8", "make it 9 instead".
// ctx.alarm_id is the alarm this chat last set or showed ("it", "that one").

const ALARM_FILLER = /\b(?:my|the|that|this|which|is|was|thats|that's|one|alarms?|i|just|set|made|created|added|you|ringing|rings|going|goes|off|please|for|at|on|up|wake|currently|now|existing|of)\b/g;

/** The alarms a phrase points at: "in 1 hour", "7am", "tomorrow", "gym", "it". */
function resolveAlarms(t, phrase, ctx) {
  const list = t.listAlarms();
  const p = ` ${phrase.toLowerCase()} `;
  const last = ctx?.alarm_id ? list.find((a) => a.id === ctx.alarm_id) : null;
  if (last && /\b(?:it|that|this|last|latest|new|newest|recent|just|same)\b/.test(p) && !/\d/.test(p)) return [last];
  // "in 1 hour", "in 30 minutes": the one ringing about then.
  const dur = new RegExp(String.raw`\bin\s+(${DURATION})\b`).exec(p);
  if (dur) {
    const at = t.clock() + parseDuration(dur[1]) * 1000;
    return list.filter((a) => a.next_at && Math.abs(a.next_at - at) <= 5 * 60000);
  }
  // "7am", "11:14", "at 8"
  const c = /\b(\d{1,2}(?:[:.]\d{2})?\s*(?:a\s?m|p\s?m)?|noon|midnight)\b/.exec(p);
  if (c) {
    const k = parseClock(c[1]);
    if (k) {
      const hits = list.filter((a) => {
        const time = a.next_at ? localParts(a.next_at, t.tz).time : a.time;
        if (!time) return false;
        const m = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
        return k.ampm ? m === k.minutes : m % 720 === k.minutes % 720;
      });
      if (hits.length) return hits;
    }
  }
  // "tomorrow's alarm", "thursday's alarm": the ones ringing that day (one you set beats a lecture one).
  const day = findDay(p.trim(), t.today());
  if (day) {
    const start = zonedToEpoch(day.from, "00:00", t.tz);
    const end = zonedToEpoch(addDays(day.to, 1), "00:00", t.tz);
    const hits = list.filter((a) => a.enabled && a.next_at && a.next_at >= start && a.next_at < end);
    const own = hits.filter((a) => !a.lead_event_id && !a.lead_course_id);
    return own.length === 1 ? own : hits;
  }
  // Words of its label: "gym", "call mom".
  const words = p.replace(ALARM_FILLER, " ").replace(/['’]s\b/g, "").split(/\s+/).filter((w) => w.length > 1 && !/^(?:it|alarm|today|tomorrow)$/.test(w));
  if (words.length) return list.filter((a) => words.every((w) => a.label.toLowerCase().includes(w)));
  // Nothing named: the one this chat last touched, else the only one of yours that will ring.
  if (last) return [last];
  return list.filter((a) => a.enabled && a.next_at && !a.lead_event_id && !a.lead_course_id);
}

function alarmCommand(t, raw, ctx) {
  const s = clean(raw).toLowerCase();
  const aboutAlarm = /\balarms?\b/.test(s) || (ctx?.last === "alarm" && /\b(?:it|that|this one|that one)\b/.test(s));
  if (!aboutAlarm) return null;
  let m;
  // Move: "move my gym alarm to 8", "change it to 7:30", "make it 9 instead", "push the alarm to 8am tomorrow".
  if ((m = /^(?:change|move|make|set|push|shift|reschedule|update|put)\s+(.+?)\s+(?:to|for|at)\s+(.+?)(?:\s+instead)?$/.exec(s)) || (m = /^make\s+(it|that)\s+(.+?)(?:\s+instead)?$/.exec(s))) {
    const found = resolveAlarms(t, m[1], ctx);
    if (found.length !== 1) return null;
    const a = found[0];
    const w = parseWhen(m[2].replace(/^(?:at|for)\s+/, ""), { tz: t.tz, now: t.clock(), wake: /wake/.test(a.label.toLowerCase()) });
    if (!w) return null;
    const row = t.setAlarm({ alarm_id: a.id, time: w.time, ...(w.days ? { days: w.days } : { date: w.date }), enabled: true });
    const card = alarmCard(t, row, "changed");
    return { text: `Moved ${a.label !== "Alarm" ? `"${a.label}"` : "your alarm"} to ${card.time} ${card.when}.`, tools: [{ tool: "set_alarm", status: "completed" }], ids: { alarm_id: row.id }, cards: [card] };
  }
  let verb = /^(cancel|delete|remove|clear|get rid of|kill|drop|scrap|turn off|switch off|disable|silence|mute|stop|turn on|switch on|enable|unmute)\b/.exec(s);
  let rest = verb ? s.slice(verb[0].length).trim() : "";
  // "turn it back on", "switch the gym alarm off"
  const split = !verb && /^(turn|switch)\s+(.+?)\s+(?:back\s+)?(on|off)$/.exec(s);
  if (split) { verb = [split[0], `${split[1]} ${split[3]}`]; rest = split[2].replace(/\s+back$/, ""); }
  if (!verb) return null;
  const on = /^(?:turn on|switch on|enable|unmute)$/.test(verb[1]);
  const off = /^(?:turn off|switch off|disable|silence|mute|stop)$/.test(verb[1]);
  const tools = [{ tool: on || off ? "set_alarms_enabled" : "remove_alarm", status: "completed" }];
  // "turn off all my alarms" (deleting them all is the model's, with a question first)
  if (/^(?:all|every)\b/.test(rest) && !/\b(?:in|at|tomorrow|today|\d)/.test(rest.replace(/^(?:all|every)\s+/, ""))) {
    if (!on && !off) return null;
    const pick = t.listAlarms().filter((a) => !!a.enabled !== on);
    for (const a of pick) t.setAlarm({ alarm_id: a.id, enabled: on });
    return { text: pick.length ? `Turned ${on ? "on" : "off"} ${pick.length} alarm${pick.length > 1 ? "s" : ""}.` : `All your alarms are already ${on ? "on" : "off"}.`, tools, cards: pick.slice(0, 4).map((a) => alarmCard(t, a, on ? "on" : "off")) };
  }
  const found = resolveAlarms(t, rest, ctx).filter((a) => (on ? !a.enabled : off ? a.enabled : true));
  if (found.length !== 1) return null;
  const a = found[0];
  const card = alarmCard(t, a, "set");
  const name = a.label && a.label !== "Alarm" ? `"${a.label}"` : `the ${card.time} alarm`;
  if (on || off) {
    t.setAlarm({ alarm_id: a.id, enabled: on });
    return { text: `Turned ${on ? "on" : "off"} ${name}.`, tools, ids: { alarm_id: a.id }, cards: [alarmCard(t, a, on ? "on" : "off")] };
  }
  t.removeAlarm({ alarm_id: a.id });
  return { text: `Removed ${name}${card.when ? ` (${card.when})` : ""}.`, tools, cards: [{ ...card, state: "removed", enabled: false }] };
}

// --- notes by what people say -------------------------------------------------------------
//
// "add a note: buy lino", "note that the exam is on the 5th", "write down call the printer",
// "add carbon paper to my to buy list", "add 'read chapter 3' to the printmaking notes".

function courseIn(t, words) {
  const w = words.toLowerCase().replace(/\b(?:my|the|class|course|lecture|notes?)\b/g, " ").trim();
  if (!w) return null;
  const parts = w.split(/\s+/);
  return t.listCourses().find((c) => parts.every((p) => `${c.name} ${c.code || ""}`.toLowerCase().includes(p))) || null;
}

function noteCommand(t, raw) {
  const s = clean(raw);
  let m;
  // Add to an existing note or list: "add X to my to buy list".
  if ((m = /^(?:add|put|append)\s+(.+?)\s+(?:to|on|in)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:note|list|notes))?$/i.exec(s)) && !/\b(?:calendar|schedule|alarms?|timers?|drive|folder)\b/i.test(m[2])) {
    const what = m[1].replace(/^["']|["']$/g, "").trim();
    const target = m[2].toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (!what || !target) return null;
    const notes = t.store.all("notes").filter((n) => !n.deleted);
    const words = target.split(" ");
    let hits = notes.filter((n) => words.every((w) => (n.title || "").toLowerCase().includes(w)));
    if (hits.length > 1) hits = hits.sort((a, b) => b.updated_at - a.updated_at).slice(0, 1);
    if (hits.length !== 1) return null;
    const n = hits[0];
    const body = String(n.body || "").replace(/\s+$/, "");
    // Keep the note's own list style: a to-do list gets a to-do, a bullet list a bullet.
    const line = /^\s*[-*] \[[ xX]\]/m.test(body) ? `- [ ] ${what}` : /^\s*[-*] /m.test(body) ? `- ${what}` : /^\s*\d+\. /m.test(body) ? `${(body.match(/^\s*\d+\. /gm) || []).length + 1}. ${what}` : what;
    const row = t.store.upsert("notes", { id: n.id, body: body ? `${body}\n${line}` : line });
    const d = t.describeNote(row);
    return { text: `Added "${what}" to ${(n.title || "").replace(/[\s:.;,-]+$/, "") || "your note"}.`, tools: [{ tool: "append_note", status: "completed" }], ids: { note_id: n.id }, cards: [{ kind: "note", state: "changed", label: d.title || "Untitled", course: d.course_name || "", id: n.id }] };
  }
  // A new note.
  if (!(m = /^(?:add|make|create|write|take|new|start)\s+(?:a\s+|me\s+a\s+)?(?:new\s+)?note\s*(?:that says|saying|that|:|-|—)?\s*(.*)$/i.exec(s)) && !(m = /^(?:note(?:\s+that|\s*:)|write down|jot down|remember that|make a note of)\s+(.+)$/i.exec(s))) return null;
  let body = (m[1] || "").replace(/^["']|["']$/g, "").trim();
  let course = null;
  const tail = /\s+(?:for|in|under|to)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:class|course|notes?))?$/i.exec(body);
  if (tail) {
    const c = courseIn(t, tail[1]);
    if (c) { course = c; body = body.slice(0, tail.index).trim(); }
  }
  body = body.replace(/^(?:about|on)\s+/i, "");
  if (!body) return null;
  const title = body.split("\n")[0].replace(/[.:;,]+$/, "").slice(0, 48).replace(/^./, (x) => x.toUpperCase());
  const row = t.addNote({ course: course?.id, title, body: body.length > title.length ? body : "" });
  const d = t.describeNote(row);
  return { text: `Saved a note "${title}"${d.course_name ? ` in ${d.course_name}` : ""}.`, tools: [{ tool: "add_note", status: "completed" }], ids: { note_id: row.id }, cards: [{ kind: "note", state: "added", label: title, course: d.course_name || "", id: row.id }] };
}

// "add dentist on thursday at 4pm", "put lunch with omar tomorrow 1pm to 2:30pm",
// "schedule a meeting on the 25th at 10 for 2 hours": one event, an hour unless said.
function eventRequest(t, raw) {
  const s = clean(raw);
  const m = /^(?:add|put|schedule|book|create|make|set up|plan)\s+(?:a\s+|an\s+|my\s+)?(?:new\s+)?(?:event\s+|appointment\s+)?(.+)$/i.exec(s);
  if (!m || /\b(?:alarm|timer|note|birthday|bday|reminder|course|class|lecture|clock)s?\b/i.test(m[1])) return null;
  const low = ` ${m[1].toLowerCase()} `;
  const day = findDay(low.trim(), t.today());
  // The times: "at 4pm", "4-6pm", "from 1pm to 2:30pm", "for 2 hours".
  const T = String.raw`(\d{1,2}(?:[:.]\d{2})?\s*(?:a\s?m|p\s?m)?|noon|midnight)`;
  const range = new RegExp(String.raw`\s(?:from\s+|at\s+)?${T}\s*(?:-|–|to|until|till)\s*${T}\s`).exec(low);
  const single = range ? null : new RegExp(String.raw`\s(?:at|@)\s+${T}\s|\s${T.replace("?|noon", "|noon")}\s`).exec(low);
  const atText = range ? range[1] : single ? single[1] || single[2] : null;
  if (!atText || !day || day.from !== day.to) return null;
  let start = parseClock(atText.replace(/\./, ":"));
  if (!start) return null;
  let end = range ? parseClock(range[2].replace(/\./, ":")) : null;
  // "4-6pm": the pm of the end goes to the start too.
  if (range && end && !start.ampm && end.ampm && end.minutes >= 720 && start.minutes < 720 && start.minutes + 720 < end.minutes) start = { minutes: start.minutes + 720, ampm: true };
  // A bare hour like "at 4" is afternoon when that is the likelier one (1-7 → pm).
  if (!start.ampm && start.minutes >= 60 && start.minutes < 8 * 60) start = { minutes: start.minutes + 720, ampm: true };
  const dur = /\sfor\s+(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)(?:\s*(?:and\s+)?\d+\s*(?:minutes?|mins?|m))?|an hour|half an hour|an hour and a half)\s/.exec(low);
  let endMin = end ? end.minutes : start.minutes + (dur ? Math.round((parseDuration(dur[1]) || 3600) / 60) : 60);
  if (endMin <= start.minutes) endMin = Math.min(start.minutes + 60, 23 * 60 + 59);
  // The title: what is left once the day and times are taken out.
  let title = ` ${day.rest} `
    .replace(range ? range[0].trim() : single ? single[0].trim() : "", " ")
    .replace(dur ? dur[0].trim() : "", " ")
    .replace(/\s(?:on|at|from|for|this|next)\s*$/i, " ")
    .replace(/\s(?:on|at)\s/gi, " ")
    .replace(/\s(?:to|in|on)\s+(?:my\s+|the\s+)?(?:calendar|schedule)\b/i, " ")
    .replace(/\s+/g, " ").trim();
  if (!title || title.split(" ").length > 8) return null;
  title = title.charAt(0).toUpperCase() + title.slice(1);
  const hhmm = (x) => `${String(Math.floor(x / 60) % 24).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  const row = t.addEvent({ title, kind: "event", date: day.from, start: hhmm(start.minutes), end: hhmm(Math.min(endMin, 23 * 60 + 59)) });
  const ev = t.findEvents({ limit: 500 }).events.find((e) => e.event_id === row.id);
  const card = eventCard(t, ev || { title, date: day.from, start_time: row.start_time, end_time: row.end_time }, "added");
  return { text: `Added ${title}: ${card.when}, ${card.time}.`, tools: [{ tool: "add_event", status: "completed" }], cards: [card] };
}

// --- reminders and timers by what people call them -------------------------------------
//
// "remove the 1 hour reminder to play a game", "cancel my reminder", "stop it",
// "pause the timer", "add 5 minutes to my timer", "cancel all timers".
// A reminder is a timer ("remind me in 1 hour") or an alarm ("remind me at 9pm").

function reminderCommand(t, raw, ctx) {
  const s = clean(raw).toLowerCase();
  const kindWord = /\b(?:timers?|reminders?|countdowns?)\b/.test(s);
  const itWord = /\b(?:it|that|this one|that one)\b/.test(s) && ctx?.last === "timer";
  if (!kindWord && !itWord) return null;
  let m;
  let verb = null;
  let rest = "";
  let addMin = 0;
  if ((m = /^add\s+(\d+|an?|one|two|three|five|ten|fifteen|twenty|thirty)\s*(?:more\s+)?(minutes?|mins?|m|hours?|hrs?|h)\s+(?:more\s+)?(?:to|on)\s+(.+)$/.exec(s))) {
    verb = "add";
    addMin = num(m[1]) * (/^h/.test(m[2]) ? 60 : 1);
    rest = m[3];
  } else if ((m = /^(cancel|delete|remove|clear|stop|end|kill|dismiss|drop|scrap|get rid of|reset|pause|hold|resume|unpause|continue|restart)\s+(.*)$/.exec(s))) {
    verb = m[1];
    rest = m[2];
  } else return null;
  const timers = t.listTimers().filter((x) => x.state === "running" || x.state === "paused");
  const alarms = /\breminders?\b/.test(s) ? t.listAlarms().filter((a) => a.enabled && a.next_at && !a.lead_event_id && !a.lead_course_id) : [];
  const all = /^(?:all|every)\b/.test(rest);
  const p = ` ${rest} `;
  let pick;
  if (all) pick = timers;
  else if (/\b(?:it|that|this|last|latest|new|just)\b/.test(p) && ctx?.timer_id && timers.some((x) => x.id === ctx.timer_id)) pick = timers.filter((x) => x.id === ctx.timer_id);
  else {
    const dur = new RegExp(String.raw`\b(?:in\s+|for\s+)?(${DURATION})\b`).exec(p);
    const words = p.replace(new RegExp(String.raw`\b(?:in\s+|for\s+)?${DURATION}\b`), " ")
      .replace(/\b(?:my|the|that|this|which|is|was|thats|that's|one|timers?|reminders?|countdowns?|to|for|i|just|set|made|you|about|please|a|an|of)\b/g, " ")
      .replace(/['’]s\b/g, "").split(/\s+/).filter((w) => w.length > 1);
    const byWords = (list) => (words.length ? list.filter((x) => words.every((w) => x.label.toLowerCase().includes(w))) : list);
    pick = byWords(timers);
    // "the 1 hour reminder": the one that was an hour long, or rings in about an hour.
    if (dur && pick.length > 1) {
      const secs = parseDuration(dur[1]);
      const near = pick.filter((x) => Math.abs((x.duration_s ?? 0) - secs) <= 60 || (x.ends_at && Math.abs(x.ends_at - (t.clock() + secs * 1000)) <= 5 * 60000));
      if (near.length) pick = near;
    }
    if (!pick.length && alarms.length) {
      // A reminder that is an alarm ("remind me at 9pm to call mom").
      const hits = byWords(alarms);
      if (hits.length === 1 && /^(?:cancel|delete|remove|clear|stop|end|kill|dismiss|drop|scrap|get rid of)$/.test(verb)) {
        const a = hits[0];
        const card = alarmCard(t, a, "set");
        t.removeAlarm({ alarm_id: a.id });
        return { text: `Removed the "${a.label}" reminder.`, tools: [{ tool: "remove_alarm", status: "completed" }], cards: [{ ...card, state: "removed", enabled: false }] };
      }
    }
  }
  if (!pick.length) return timers.length || alarms.length ? null : { text: "No timer or reminder is running.", tools: [{ tool: "list_timers", status: "completed" }] };
  if (pick.length > 1 && !all) return null;
  const cardOf = (x, state) => ({ kind: "timer", id: x.id, state, label: x.label, ends_at: x.ends_at, duration_s: x.duration_s });
  const tools = [{ tool: "update_timer", status: "completed" }];
  const name = pick.length === 1 ? `"${pick[0].label}"` : `${pick.length} timers`;
  if (verb === "add") {
    let row = null;
    for (let i = 0; i < addMin; i++) row = t.updateTimer({ timer_id: pick[0].id, action: "add_minute" });
    return { text: `Added ${addMin} min to ${name}.`, tools, ids: { timer_id: pick[0].id }, cards: [cardOf(row || pick[0], "running")] };
  }
  if (/^(?:pause|hold)$/.test(verb)) {
    const rows = pick.filter((x) => x.state === "running").map((x) => t.updateTimer({ timer_id: x.id, action: "pause" }));
    return { text: rows.length ? `Paused ${name}.` : `${name} is already paused.`, tools, cards: rows.slice(0, 4).map((x) => cardOf(x, "stopped")) };
  }
  if (/^(?:resume|unpause|continue)$/.test(verb)) {
    const rows = pick.filter((x) => x.state === "paused").map((x) => t.updateTimer({ timer_id: x.id, action: "resume" }));
    return { text: rows.length ? `Resumed ${name}.` : `${name} is already running.`, tools, cards: rows.slice(0, 4).map((x) => cardOf(x, "running")) };
  }
  if (verb === "restart") {
    const row = t.updateTimer({ timer_id: pick[0].id, action: "restart" });
    return { text: `Restarted ${name}.`, tools, ids: { timer_id: row.id }, cards: [cardOf(row, "running")] };
  }
  for (const x of pick) t.updateTimer({ timer_id: x.id, action: "reset" });
  return { text: `Cancelled ${name}.`, tools: [{ tool: "stop_timers", status: "completed" }], cards: pick.slice(0, 4).map((x) => ({ ...cardOf(x, "stopped"), ends_at: null })) };
}

// --- events: remove or move by name --------------------------------------------------------
//
// "cancel the dentist", "remove thursday's dentist", "delete lunch with omar",
// "move the dentist to friday at 5pm", "push study group to 6pm".
// A whole repeating series is never removed here (the model asks first).

function eventsNamed(t, words, day) {
  const evs = t.findEvents({ limit: 500 }).events.filter((e) => e.next || e.date);
  const hits = evs.filter((e) => words.every((w) => `${e.title} ${e.course_name || ""}`.toLowerCase().includes(w)));
  if (!day) return hits;
  const on = new Set(t.schedule({ from: day.from, to: day.to }).occurrences.map((o) => o.event_id));
  return hits.filter((e) => on.has(e.event_id));
}

function eventCommand(t, raw) {
  const s = clean(raw).toLowerCase();
  let m;
  const move = /^(?:move|reschedule|push|shift|change|postpone|bring forward)\s+(.+?)\s+(?:to|till|until)\s+(.+)$/.exec(s);
  const del = !move && /^(?:cancel|delete|remove|clear|drop|scrap|get rid of)\s+(.+)$/.exec(s);
  if (!move && !del) return null;
  const target = (move ? move[1] : del[1]).replace(/\b(?:alarms?|timers?|reminders?|notes?)\b/, "\u0000");
  if (target.includes("\u0000")) return null;
  const day = findDay(target, t.today());
  const words = (day ? day.rest : target).replace(/\b(?:my|the|that|this|event|appointment|meeting with|on|at|for|one)\b/g, " ").replace(/['’]s\b/g, "").split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return null;
  const hits = eventsNamed(t, words, day);
  if (hits.length !== 1) return null;
  const e = hits[0];
  const row = t.store.get("events", e.event_id);
  const repeating = !!row.repeat;
  if (del) {
    if (repeating && !day) return null; // the whole series: the model confirms first
    const card = eventCard(t, e, "removed");
    if (repeating) {
      t.removeEvent({ event_id: row.id, scope: "occurrence", date: day.from });
      const when = /^(?:today|tomorrow|yesterday)$/.test(day.word) ? `${day.word}'s ${e.title}` : `${e.title} on ${day.word}`;
      return { text: `Removed ${when}. The other ones stay.`, tools: [{ tool: "remove_event", status: "completed" }], cards: [{ ...card, when: day.word, days_until: null }] };
    }
    t.removeEvent({ event_id: row.id });
    return { text: `Removed ${e.title}.`, tools: [{ tool: "remove_event", status: "completed" }], cards: [card] };
  }
  if (repeating) return null; // moving one of a series: the model does it carefully
  // Where to: a day, a time, or both ("friday at 5pm", "6pm", "tomorrow").
  const to = ` ${move[2]} `;
  const nd = findDay(to.trim(), t.today());
  const tm = /\b(\d{1,2}(?:[:.]\d{2})?\s*(?:a\s?m|p\s?m)?|noon|midnight)\b/.exec(nd ? ` ${nd.rest} ` : to);
  let clockMin = tm ? parseClock(tm[1].replace(".", ":")) : null;
  if (!nd && !clockMin) return null;
  if (clockMin && !clockMin.ampm && clockMin.minutes >= 60 && clockMin.minutes < 8 * 60) clockMin = { minutes: clockMin.minutes + 720, ampm: true };
  const len = (Number(row.end_time.slice(0, 2)) * 60 + Number(row.end_time.slice(3))) - (Number(row.start_time.slice(0, 2)) * 60 + Number(row.start_time.slice(3)));
  const hhmm = (x) => `${String(Math.floor(x / 60) % 24).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  const patch = { event_id: row.id };
  if (nd) patch.date = nd.from;
  if (clockMin) { patch.start = hhmm(clockMin.minutes); patch.end = hhmm(Math.min(clockMin.minutes + Math.max(len, 15), 23 * 60 + 59)); }
  t.updateEvent(patch);
  const moved = t.findEvents({ limit: 500 }).events.find((x) => x.event_id === row.id) || e;
  const card = eventCard(t, moved, "changed");
  return { text: `Moved ${e.title} to ${card.when}, ${card.time}.`, tools: [{ tool: "update_event", status: "completed" }], cards: [card] };
}

// --- attendance -------------------------------------------------------------------------------
//
// "mark today as attended", "I was absent today", "I skipped printmaking yesterday",
// "no class tomorrow" (off), "clear today's mark".

function attendanceCommand(t, raw) {
  const s = clean(raw).toLowerCase();
  let status = null;
  if (/\b(?:attended|present|went to|was at|was in|made it to|been to)\b/.test(s)) status = "attended";
  else if (/\b(?:absent|missed|skipped|didn't go|did not go|wasn't at|was not at|couldn't make)\b/.test(s)) status = "absent";
  else if (/\b(?:no class|no lecture|class is off|lecture is off|cancelled class|class cancelled|is cancelled|day off|off day|as off|to off)\b/.test(s)) status = "off";
  else if (/\b(?:clear|unmark|remove)\b.*\bmark\b/.test(s)) status = "none";
  if (!status || /\b(?:alarm|timer|note)\b/.test(s)) return null;
  // Only about classes: "I missed my bus today" is not an absence.
  const classWord = /\b(?:mark|marked|class|classes|lecture|lectures|session|sessions|course|absent|attended|present|attendance|attendence|attendace)\b/.test(s);
  // The closest day: attendance is mostly marked after the class.
  const day = findDay(s, t.today(), { near: true }) || { from: t.today(), to: t.today(), word: "today", rest: s };
  if (day.from !== day.to) return null;
  const all = t.schedule({ from: day.from, to: day.from }).occurrences;
  let occ = all.filter((o) => o.course_id);
  // A course named: only that one. Everything else in the sentence is filler.
  const words = day.rest
    .replace(/[.,!?]/g, " ")
    .replace(/\b(?:mark|marked|set|put|make|change|update|log|record|as|for|on|of|i|was|were|am|the|my|all|every|each|class|classes|lecture|lectures|session|sessions|course|courses|attendance|attendence|attendace|attendances|attended|present|absent|missed|skipped|went|to|at|in|off|no|today|it|didn't|did|not|go|clear|unmark|remove|is|cancelled|day|please|and|me|that|this|status)\b/g, " ")
    .split(/\s+/).filter((w) => w.length > 2);
  if (words.length) occ = occ.filter((o) => words.every((w) => o.title.toLowerCase().includes(w)));
  if (!classWord && (!words.length || !occ.length)) return null;
  const when = day.word === "today" || day.word === "tomorrow" || day.word === "yesterday" ? day.word : "on " + day.word;
  if (!occ.length) {
    const classes = all.filter((o) => o.course_id).map((o) => o.title);
    const text = words.length && classes.length ? `No class ${when} matching "${words.join(" ")}". ${cap(when)} you have ${classes.join(" and ")}.` : `You have no classes ${when}, so there's nothing to mark.`;
    return { text, tools: [{ tool: "get_schedule", status: "completed" }], cards: [dayCard(t, day.from, day.word)] };
  }
  for (const o of occ) t.markSession({ event_id: o.event_id, date: day.from, status });
  const what = { attended: "attended", absent: "absent", off: "off (no class)", none: "unmarked" }[status];
  return { text: `Marked ${occ.map((o) => o.title).join(" and ")} ${day.word} as ${what}.`, tools: [{ tool: "mark_session", status: "completed" }], cards: [dayCard(t, day.from, day.word)] };
}

// --- world clock --------------------------------------------------------------------------------
//
// "what time is it in tokyo", "time in new york", "add london to my world clock".

function zoneOf(t, name) {
  const n = name.trim().toLowerCase().replace(/[?.!]+$/, "");
  if (ZONES[n]) return ZONES[n];
  try { return t.searchZones({ query: n, limit: 1 })[0]?.zone || null; } catch { return null; }
}

function clockCommand(t, raw) {
  const s = clean(raw).toLowerCase();
  let m;
  const h12 = t.settings().time_format !== "24h";
  // "what's the time right now", "what time is it", "what day is it", "what's today's date".
  const here = localParts(t.clock(), t.tz);
  const nice = `${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][weekday(here.date) - 1]} ${Number(here.date.slice(8))} ${MONTH_NAMES[Number(here.date.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase())}`;
  const timeNow = fmtClock(Number(here.time.slice(0, 2)) * 60 + Number(here.time.slice(3, 5)), h12);
  if (/^(?:what(?:'s|s| is)?\s+)?(?:the\s+)?(?:current\s+)?time(?:\s+is\s+it)?(?:\s+(?:right\s+)?now)?$|^what time is it(?:\s+(?:right\s+)?now)?$|^(?:tell me|give me) the time$|^time$/.test(s)) {
    return { text: `It's ${timeNow}, ${nice}.`, tools: [{ tool: "world_clock", status: "completed" }] };
  }
  if (/^(?:what(?:'s|s| is)?\s+)?(?:the\s+|today's\s+)?(?:date|day)(?:\s+(?:is it|today|is today))?(?:\s+(?:right\s+)?now)?$|^what day is it(?:\s+today)?$|^what(?:'s| is) today$|^what(?:'s| is) the date today$/.test(s)) {
    return { text: `Today is ${nice} ${here.date.slice(0, 4)}. It's ${timeNow}.`, tools: [{ tool: "world_clock", status: "completed" }] };
  }
  if ((m = /^(?:what(?:'s| is)?\s+)?(?:the\s+)?time(?:\s+is\s+it)?\s+(?:in|at)\s+(.+)$|^what time is it (?:in|at)\s+(.+)$/.exec(s))) {
    const z = zoneOf(t, m[1] || m[2]);
    if (!z) return null;
    const p = localParts(t.clock(), z);
    const home = localParts(t.clock(), t.tz);
    const diff = Math.round((zonedToEpoch(home.date, home.time, z) - zonedToEpoch(home.date, home.time, t.tz)) / -3600000 * 2) / 2;
    const city = z.split("/").pop().replace(/_/g, " ");
    return { text: `It's ${fmtClock(Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3, 5)), h12)} in ${city}${p.date !== home.date ? (p.date > home.date ? " (tomorrow)" : " (yesterday)") : ""}${diff ? `, ${Math.abs(diff)} h ${diff > 0 ? "ahead of" : "behind"} you` : ", same as you"}.`, tools: [{ tool: "world_clock", status: "completed" }] };
  }
  if ((m = /^add\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(?:world\s+)?clocks?$/.exec(s))) {
    const z = zoneOf(t, m[1]);
    if (!z) return null;
    const row = t.addClock({ zone: z });
    return { text: `Added ${row.label || z.split("/").pop().replace(/_/g, " ")} to your world clock.`, tools: [{ tool: "add_clock", status: "completed" }] };
  }
  return null;
}

// --- settings -------------------------------------------------------------------------------------
//
// "use 24 hour time", "switch to 12h", "turn the alarm sound off", "set my ringtone to klaxon",
// "start the week on monday".

function settingsCommand(t, raw) {
  const s = clean(raw).toLowerCase();
  let m;
  const done = (text, args, tool = "set_settings") => ({ text, tools: [{ tool, status: "completed" }], cards: [{ kind: "setting", label: "Settings", value: text.replace(/\.$/, "") }], _apply: args });
  if (/\b24[\s-]?(?:hour|hr|h)\b/.test(s) && /\b(?:use|switch|change|set|make|show|turn on)\b/.test(s)) { t.setSettings({ time_format: "24h" }); return done("Times now show in 24-hour format."); }
  if (/\b12[\s-]?(?:hour|hr|h)\b/.test(s) && /\b(?:use|switch|change|set|make|show)\b/.test(s)) { t.setSettings({ time_format: "12h" }); return done("Times now show in 12-hour format (AM/PM)."); }
  if ((m = /\b(?:alarm\s+)?sound\s+(off|on)\b|\b(?:turn|switch)\s+(off|on)\s+(?:the\s+)?(?:alarm\s+)?sound\b|\b(?:turn|switch)\s+(?:the\s+)?(?:alarm\s+)?sound\s+(off|on)\b|\b(mute|unmute)\s+(?:the\s+)?alarms?\b/.exec(s))) {
    const on = /^(?:on|unmute)$/.test(m[1] || m[2] || m[3] || m[4]);
    t.setSettings({ sound: on });
    return done(on ? "Alarm sound is on." : "Alarm sound is off: alarms only vibrate and show.");
  }
  if ((m = /^(?:set|change|switch|make|use)\s+(?:my\s+|the\s+)?(?:alarm\s+)?(?:ringtone|alarm sound|sound)\s+(?:to|as)\s+(.+)$/.exec(s))) {
    const want = m[1].replace(/^(?:the\s+)?/, "").replace(/\s+(?:ringtone|sound|song)$/, "");
    const r = t.listRingtones().find((x) => x.name.toLowerCase() === want || x.id === want || x.name.toLowerCase().includes(want));
    if (!r) return null;
    t.setRingtone({ ringtone: r.kind === "builtin" ? r.id : r.id });
    return done(`Alarms now ring with ${r.name}.`, null, "set_ringtone");
  }
  if ((m = /\bweek\s+(?:to\s+)?start(?:s)?\s+(?:on\s+)?(saturday|sunday|monday)\b|\bstart\s+(?:the|my)\s+week\s+on\s+(saturday|sunday|monday)\b/.exec(s))) {
    const d = m[1] || m[2];
    t.setSettings({ week_start: d === "monday" ? 1 : d === "saturday" ? 6 : 7 });
    return done(`Your week now starts on ${d.charAt(0).toUpperCase() + d.slice(1)}.`);
  }
  return null;
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

const MON_RE = MONTH_NAMES.map((m) => m.slice(0, 3) + (m === "september" ? "(?:t|tember)?" : `(?:${m.slice(3)})?`)).join("|");
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
export function quickAnswer(service, text, ctx = {}) {
  if (!text || text.length > 300 || /\n/.test(text.trim())) return null;
  for (const f of [reminderCommand, alarmCommand, settingsCommand, clockCommand, attendanceCommand, noteCommand, eventCommand, eventRequest, stopTimerRequest, remindRequest, addBirthdayRequest, readAnswer, upcomingRequest, howLongRequest, timerRequest, alarmRequest, lookupRequest, bareBirthdayRequest, scheduleRequest, alarmsRequest]) {
    try {
      const r = f(service, text, ctx);
      if (r) return r;
    } catch {
      // A tool said no (a bad time, a missing course): the model can explain it better.
      return null;
    }
  }
  return null;
}
