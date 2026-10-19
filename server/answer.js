// Questions about the user's own data, answered at once from that data, with
// no model: "what's my alarm tomorrow", "what do I have on Thursday", "list my
// schedule next week", "tell me tomorrow's project notes", "how long is left
// on my timer". A model run takes seconds (and a free one can stall); reading
// your own alarm should take no time at all.
//
// Only questions are answered here. Anything that asks for a change, or that
// this can't pin down (a topic and, where needed, a day), returns null and
// goes to the fast lane's actions or to the model.
import { WEEKDAYS, addDays, localParts, weekday, zonedToEpoch } from "../core/dates.js";
import { dueBetween } from "../core/alarms.js";
import { plainText } from "../core/noteformat.js";
import { alarmCard, dayCard } from "./cards.js";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_RE = MONTHS.map((m) => m.slice(0, 3) + "[a-z]*").join("|");

// Words that ask for a change: those go to actions or the model, never here.
const WRITE = /\b(?:set|add|create|make|start|cancel|delete|remove|turn|switch|change|move|rename|edit|update|snooze|stop|pause|resume|mark|put|write|save|remind|wake me|book|clear|reset|disable|enable|tidy|fix|format|summari[sz]e|rewrite|translate)\b/;
const QUESTION = /^(?:what|whats|what's|when|whens|when's|which|do i|did i|have i|am i|is there|are there|is anything|any|show|list|tell|give|read|open|check|see|display|get|how many|how much|how long|whats on|my|today|tomorrow|tonight)\b|\?$/;

const fmtDay = (d) => `${WEEKDAYS[weekday(d) - 1]} ${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;

/** A day or a range named in the text: { from, to, word, rest } or null. */
export function findDay(s, today) {
  const hit = (re, from, to, word) => {
    const m = re.exec(s);
    return m ? { from, to: to ?? from, word, rest: (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim() } : null;
  };
  const wd = weekday(today);
  const r =
    hit(/\bday after tomorrow\b/, addDays(today, 2), null, "the day after tomorrow") ||
    hit(/\b(?:tomorrow|tmrw|tmr|tomorow|tommorow|tommorrow)(?:'s|s)?\b/, addDays(today, 1), null, "tomorrow") ||
    hit(/\b(?:today|tonight|this (?:morning|afternoon|evening))(?:'s|s)?\b/, today, null, "today") ||
    hit(/\byesterday(?:'s|s)?\b/, addDays(today, -1), null, "yesterday") ||
    hit(/\bnext week(?:'s)?\b/, addDays(today, 8 - wd), addDays(today, 14 - wd), "next week") ||
    hit(/\b(?:this|the) week(?:'s)?\b|\bthis weeks\b/, today, addDays(today, 7 - wd), "this week") ||
    hit(/\b(?:the )?(?:weekend|this weekend)\b/, addDays(today, ((6 - wd) + 7) % 7), addDays(today, ((6 - wd) + 7) % 7 + 1), "this weekend");
  if (r) return r;
  const w = new RegExp(String.raw`\b(?:(next|this|on)\s+)?(${DAYS.join("|")})(?:'s|s)?\b`).exec(s);
  if (w) {
    const target = DAYS.indexOf(w[2]) + 1;
    let d = today;
    while (weekday(d) !== target) d = addDays(d, 1);
    if (w[1] === "next" && d === today) d = addDays(d, 7);
    return { from: d, to: d, word: d === today ? "today" : d === addDays(today, 1) ? "tomorrow" : fmtDay(d), rest: (s.slice(0, w.index) + " " + s.slice(w.index + w[0].length)).replace(/\s+/g, " ").trim() };
  }
  const md = new RegExp(String.raw`\b(?:on\s+)?(?:the\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:of\s+)?(${MON_RE}))?|(${MON_RE})\s+(\d{1,2})(?:st|nd|rd|th)?)\b`).exec(s);
  if (md && (md[2] || md[3] || /\d(?:st|nd|rd|th)\b/.test(md[0]) || /\bthe\s+\d/.test(md[0]))) {
    const day = Number(md[1] || md[4]);
    let mon = md[2] || md[3] ? MONTHS.findIndex((m) => (md[2] || md[3]).startsWith(m.slice(0, 3))) + 1 : Number(today.slice(5, 7));
    let year = Number(today.slice(0, 4));
    let d = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (d < today && !(md[2] || md[3])) { mon = mon === 12 ? 1 : mon + 1; if (mon === 1) year++; d = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
    else if (d < today) d = `${year + 1}${d.slice(4)}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || day < 1 || day > 31) return null;
    return { from: d, to: d, word: fmtDay(d), rest: (s.slice(0, md.index) + " " + s.slice(md.index + md[0].length)).replace(/\s+/g, " ").trim() };
  }
  return null;
}

function clock(service) {
  const h12 = service.settings().time_format !== "24h";
  return (hhmm) => {
    const h = Number(hhmm.slice(0, 2));
    const m = hhmm.slice(3, 5);
    return h12 ? `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}` : `${String(h).padStart(2, "0")}:${m}`;
  };
}

function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 14; d = addDays(d, 1)) out.push(d);
  return out;
}

// --- the topics ---------------------------------------------------------------------

// What a lecture alarm rings before: the course (or event) name.
export function leadName(service, a) {
  const ev = a.lead_event_id ? service.store.get("events", a.lead_event_id) : null;
  const course = service.store.get("courses", a.lead_course_id || ev?.course_id || "");
  return course?.name || ev?.title || a.label.split(" · ")[0];
}

function alarms(service, day) {
  const tz = service.tz;
  const c = clock(service);
  const all = service.listAlarms().filter((a) => a.enabled);
  let rings;
  if (day) {
    const start = zonedToEpoch(day.from, "00:00", tz) - 1;
    const end = zonedToEpoch(addDays(day.to, 1), "00:00", tz) - 1;
    const data = service.data();
    rings = [];
    // Every ring in the range, not only each alarm's next one.
    for (let from = start; ;) {
      const due = dueBetween(data, from, end, tz).filter((x) => x.kind === "alarm");
      if (!due.length) break;
      rings.push(...due);
      from = Math.min(...due.map((x) => x.at));
      if (rings.length > 30) break;
    }
    const seen = new Set();
    rings = rings.filter((r) => !seen.has(r.id + r.at) && seen.add(r.id + r.at)).sort((a, b) => a.at - b.at);
  } else {
    rings = all.filter((a) => a.next_at).map((a) => ({ id: a.id, at: a.next_at, label: a.label })).sort((a, b) => a.at - b.at).slice(0, 6);
  }
  const tools = [{ tool: "list_alarms", status: "completed" }];
  const when = day ? day.word : "";
  if (!rings.length) return { text: day ? `No alarms ${when === "today" || when === "tomorrow" || when.startsWith("this") || when.startsWith("next") ? when : "on " + when}.` : "No alarms are set.", tools };
  const lines = rings.map((r) => {
    const p = localParts(r.at, tz);
    const a = all.find((x) => x.id === r.id);
    const lead = a && a.lead_minutes != null && (a.lead_event_id || a.lead_course_id) ? ` (${a.lead_minutes} min before ${leadName(service, a)})` : "";
    const name = a && a.label && a.label !== "Alarm" && !lead ? ` — ${a.label}` : "";
    if (!day) {
      const today = service.today();
      const dw = p.date === today ? "today" : p.date === addDays(today, 1) ? "tomorrow" : fmtDay(p.date);
      return `${a?.label || r.label}: ${c(p.time)} ${dw}${lead}`;
    }
    return `${day.from === day.to ? "" : fmtDay(p.date) + " "}${c(p.time)}${name}${lead}`;
  });
  const head = day ? `${when.charAt(0).toUpperCase() + when.slice(1)}:\n` : "";
  const cards = rings.slice(0, 4).map((r) => {
    const a = all.find((x) => x.id === r.id) || { id: r.id, label: r.label };
    const card = alarmCard(service, a, "on");
    const p = localParts(r.at, tz);
    return { ...card, time: c(p.time), minutes: Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3, 5)), at: r.at, state: "found" };
  });
  return { text: `${head}${lines.join("\n")}`, tools, cards };
}

function schedule(service, day) {
  const c = clock(service);
  const days = dateRange(day.from, day.to);
  const lines = [];
  const cards = [];
  for (const d of days) {
    const occ = service.schedule({ from: d, to: d }).occurrences.filter((o) => o.mark !== "off");
    if (days.length > 1) {
      if (!occ.length) continue;
      lines.push(`${fmtDay(d)}: ${occ.map((o) => `${c(o.start_time)} ${o.title}`).join(", ")}`);
    } else {
      for (const o of occ) lines.push(`${c(o.start_time)}-${c(o.end_time)} ${o.title}${o.location ? ` (${o.location})` : ""}`);
    }
    if (occ.length && cards.length < 4) cards.push(dayCard(service, d, days.length > 1 ? fmtDay(d) : day.word));
  }
  const tools = [{ tool: "get_schedule", status: "completed" }];
  if (!lines.length) return { text: `Nothing in your calendar ${day.word === "today" || day.word === "tomorrow" || day.word.startsWith("this") || day.word.startsWith("next") ? day.word : "on " + day.word}.`, tools };
  return { text: `${day.word.charAt(0).toUpperCase() + day.word.slice(1)}:\n${lines.join("\n")}`, tools, cards };
}

const STOP = new Set(["what", "whats", "what's", "my", "the", "for", "of", "on", "notes", "note", "tell", "me", "show", "list", "give", "read", "open", "all", "do", "i", "have", "any", "is", "are", "there", "in", "from", "about", "please", "class", "lecture", "session", "a", "an", "and", "to", "get", "see", "check", "s", "with", "written", "wrote", "write", "did"]);

function notes(service, day, rest) {
  const words = rest.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
  let found = [];
  // "my latest notes": the newest ones.
  const latest = words.some((w) => /^(?:latest|last|recent|newest|new)$/.test(w));
  const topic = words.filter((w) => !/^(?:latest|last|recent|newest|new|today|yesterday)$/.test(w));
  words.length = 0;
  words.push(...topic);
  // A course named: that course's notes.
  const course = !day && words.length ? service.listCourses().find((c) => words.every((w) => `${c.name} ${c.code || ""}`.toLowerCase().includes(w))) : null;
  if (course) {
    found = service.getNotes({ course: course.id, limit: 5 });
  } else if (latest && !day && !words.length) {
    found = service.getNotes({ limit: 3 });
  } else if (day) {
    for (const d of dateRange(day.from, day.to)) {
      found.push(...service.getNotes({ date: d, limit: 50 }));
      for (const o of service.schedule({ from: d, to: d }).occurrences) {
        // That session's notes (and pinned ones); none yet: the course's last session's.
        const g = service.sessionNotes(o);
        const pick = g.session.length ? [...g.session, ...g.pinned] : [...g.last, ...g.pinned];
        for (const n of pick) if (!found.some((x) => x.id === n.id)) found.push(service.describeNote(n));
      }
    }
    const seen = new Set();
    found = found.filter((n) => !n.deleted && !seen.has(n.id) && seen.add(n.id));
    // "tomorrow's project notes": the ones about the project, if any are.
    if (words.length) {
      const match = found.filter((n) => words.every((w) => `${n.title} ${n.course_name || ""} ${plainText(n.body || "")}`.toLowerCase().includes(w)));
      if (match.length) found = match;
    }
  } else if (words.length) {
    found = service.searchNotes({ query: words.join(" "), limit: 5 }).map((x) => service.describeNote(service.store.get("notes", x.note_id || x.id) || x));
  } else {
    found = service.getNotes({ limit: 3 });
  }
  found = found.filter(Boolean).slice(0, 5);
  // A free-text search that found nothing: the model may understand the question better.
  if (!found.length && !day && !course) return null;
  const tools = [{ tool: day ? "get_notes" : "search_notes", status: "completed" }];
  if (!found.length) return { text: day ? `No notes for ${day.word}${words.length ? ` about ${words.join(" ")}` : ""}.` : `No notes${words.length ? ` about ${words.join(" ")}` : ""}.`, tools };
  const parts = found.map((n) => {
    const text = plainText(n.body || "").replace(/\n{3,}/g, "\n\n").trim();
    const cut = text.length > 600 ? text.slice(0, 600).replace(/\s+\S*$/, "") + " …" : text;
    return `**${n.title || "Untitled"}**${n.course_name ? ` · ${n.course_name}` : ""}\n${cut || "(empty)"}`;
  });
  return {
    text: parts.join("\n\n"),
    tools,
    cards: found.slice(0, 4).map((n) => ({ kind: "note", state: "found", label: n.title || "Untitled", course: n.course_name || "", note_id: n.id })),
  };
}

function timers(service) {
  const list = service.listTimers().filter((t) => t.state === "running" || t.state === "paused");
  const tools = [{ tool: "list_timers", status: "completed" }];
  if (!list.length) return { text: "No timer is running.", tools };
  const spell = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return {
    text: list.map((t) => `${t.label}: ${spell(t.remaining_s ?? 0)} left${t.state === "paused" ? " (paused)" : ""}`).join("\n"),
    tools,
    cards: list.slice(0, 4).map((t) => ({ kind: "timer", state: t.state === "running" ? "running" : "stopped", label: t.label, ends_at: t.ends_at, duration_s: t.duration_s })),
  };
}

/** An answer read from the user's data, or null. */
export function readAnswer(service, raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/[’‘]/g, "'").replace(/[!.]+$/, "").replace(/\s+/g, " ");
  if (!s || s.length > 140) return null;
  const q = s.replace(/^(?:hey|hi|ok|okay|please|so|and|also)[,\s]+/, "").replace(/^(?:can|could|would|will) you\s+(?:please\s+)?/, "");
  if (WRITE.test(q.replace(/\bwake (?:me )?up\b/, "").replace(/\b(?:did i|i) (?:write|wrote|save|saved|add|added|put)\b/, ""))) return null;
  const day = findDay(q, service.today());
  // No question word: only a bare day ("tomorrow", "thursday schedule"), never a command with a time.
  const asks = QUESTION.test(q) || (!!day && !/\d/.test(day.rest) && day.rest.split(" ").length <= 4);
  if (!asks) return null;
  const rest = day ? day.rest : q;
  if (/\balarms?\b|\bwake ?up\b|\bwhen do i (?:need to )?(?:get up|wake)\b/.test(q)) return alarms(service, day);
  if (/\btimers?\b|\bcountdown\b/.test(q) && !day) return timers(service);
  if (/\bnotes?\b|\bwrote\b|\bwritten\b|\bdid i write\b/.test(q)) return notes(service, day, rest);
  if (day && /\b(?:schedule|classes|class|lectures?|lessons?|have|on|plans?|agenda|calendar|events?|busy|free|day|week|weekend|happening|going on|doing|due)\b/.test(q)) return schedule(service, day);
  if (day && rest.replace(/\b(?:what|whats|what's|is|on|my|for|me|show|list|tell|the|all|of)\b/g, "").trim() === "") return schedule(service, day);
  return null;
}
