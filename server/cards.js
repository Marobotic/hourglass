// Cards: what the assistant did, drawn in the chat instead of only said.
// "Set my alarm in 1 hour" shows an alarm card (a clock face with the time and
// a tick); a timer shows a countdown ring; a birthday the date and the days to
// go; a day its timeline. Every card is plain data with its text already
// written, so each app only draws it.
//
//   { kind: "alarm", state: "set" | "removed" | "on" | "off", label, time, when, at, minutes }
//   { kind: "timer", state: "running" | "stopped", label, ends_at, duration_s }
//   { kind: "event", label, when, time, repeats, days_until, birthday, state: "added" | "found" | "changed" | "removed" }
//   { kind: "day", label, items: [{ start, end, title, color, from, to }] }   (from/to: minutes of the day)
//   { kind: "note", label, course, state: "added" | "changed" }
//   { kind: "setting", label, value }
import { addDays, localParts, WEEKDAYS } from "../core/dates.js";

const MAX_CARDS = 4;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmt(service) {
  const h12 = service.settings().time_format !== "24h";
  const today = service.today();
  const clock = (hhmm) => {
    if (!hhmm) return "";
    const h = Number(hhmm.slice(0, 2));
    const m = hhmm.slice(3, 5);
    return h12 ? `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}` : `${String(h).padStart(2, "0")}:${m}`;
  };
  const day = (d) => {
    if (!d) return "";
    if (d === today) return "today";
    if (d === addDays(today, 1)) return "tomorrow";
    const wd = WEEKDAYS[(new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7];
    return `${wd} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(0, 4) !== today.slice(0, 4) ? " " + d.slice(0, 4) : ""}`;
  };
  const minutes = (hhmm) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : 0);
  return { clock, day, today, minutes, tz: service.tz };
}

function daysText(days) {
  if (!days?.length || days.length === 7) return "every day";
  const d = [...days].map(Number).sort().join();
  if (d === "1,2,3,4,5") return "weekdays";
  if (d === "6,7") return "weekends";
  return days.map((x) => WEEKDAYS[Number(x) - 1]).join(", ");
}

function alarmCard(service, row, state) {
  const f = fmt(service);
  const a = service.listAlarms().find((x) => x.id === row.id) || row;
  const next = a.next_at ? localParts(a.next_at, f.tz) : null;
  let when;
  if (a.lead_minutes != null && (a.lead_event_id || a.lead_course_id)) when = `${a.lead_minutes} min before ${a.label.split(" · ")[0]}`;
  else if (a.days?.length) when = daysText(a.days);
  else when = next ? f.day(next.date) : a.date ? f.day(a.date) : "";
  const time = next ? next.time : a.time;
  return { kind: "alarm", state, label: a.label || "Alarm", time: f.clock(time), when, at: a.next_at ?? null, minutes: f.minutes(time), enabled: !!a.enabled };
}

function eventCard(service, ev, state) {
  const f = fmt(service);
  const next = ev.next || (ev.date ? { date: ev.date, start_time: ev.start_time, end_time: ev.end_time } : null);
  const allDay = next && next.start_time === "00:00" && (next.end_time === "23:59" || next.end_time === "00:00");
  const days = next ? Math.round((Date.parse(next.date) - Date.parse(f.today)) / 86400000) : null;
  return {
    kind: "event", state,
    label: ev.title || "Event",
    when: next ? f.day(next.date) : "",
    time: !next ? "" : allDay ? "all day" : `${f.clock(next.start_time)} – ${f.clock(next.end_time)}`,
    repeats: ev.repeats && ev.repeats !== "once" ? ev.repeats : "",
    days_until: days,
    birthday: /birth|bday|b-day/i.test(ev.title || ""),
  };
}

function dayCard(service, date, label) {
  const f = fmt(service);
  const occ = service.schedule({ from: date, to: date }).occurrences.filter((o) => o.mark !== "off");
  return {
    kind: "day", label,
    items: occ.slice(0, 12).map((o) => ({ start: f.clock(o.start_time), end: f.clock(o.end_time), title: o.title, color: o.color || (o.course_id && service.store.get("courses", o.course_id)?.color) || null, from: f.minutes(o.start_time), to: f.minutes(o.end_time), location: o.location || "" })),
  };
}

/** Cards for one tool call that worked. args: what it was called with; result: what it returned. */
export function cardsFor(service, tool, args = {}, result = null) {
  try {
    const f = fmt(service);
    switch (tool) {
      case "set_alarm":
        return result?.id ? [alarmCard(service, result, args.alarm_id ? (args.enabled === false ? "off" : args.enabled === true && Object.keys(args).length <= 2 ? "on" : "set") : "set")] : [];
      case "remove_alarm":
        return result ? [{ kind: "alarm", state: "removed", label: result.label || "Alarm", time: f.clock(result.time), when: "", at: null, minutes: f.minutes(result.time), enabled: false }] : [];
      case "set_alarms_enabled":
        return (result?.changed ?? []).slice(0, MAX_CARDS).map((x) => alarmCard(service, { id: x.id, label: x.label }, args.enabled ? "on" : "off"));
      case "start_timer":
        return result?.id ? [{ kind: "timer", state: "running", label: result.label, ends_at: result.ends_at, duration_s: result.duration_s }] : [];
      case "update_timer":
        if (["stop", "reset", "done"].includes(args.action)) return [{ kind: "timer", state: "stopped", label: result?.label || "Timer", ends_at: null, duration_s: result?.duration_s ?? 0 }];
        return result?.id && result.state === "running" ? [{ kind: "timer", state: "running", label: result.label, ends_at: result.ends_at, duration_s: result.duration_s }] : [];
      case "stop_timers":
        return (result?.stopped ?? []).slice(0, MAX_CARDS).map((x) => ({ kind: "timer", state: "stopped", label: x.label, ends_at: null, duration_s: 0 }));
      case "add_event":
      case "add_birthday":
      case "update_event": {
        if (!result?.id) return [];
        const found = service.findEvents({ limit: 500 }).events.find((e) => e.event_id === result.id);
        return [eventCard(service, found || { title: result.title, date: result.start_date, start_time: result.start_time, end_time: result.end_time }, tool === "update_event" ? "changed" : "added")];
      }
      case "find_events":
        return (result?.events ?? []).filter((e) => e.next).slice(0, 3).map((e) => eventCard(service, e, "found"));
      case "upcoming_events":
        return (result?.events ?? []).slice(0, 3).map((e) => eventCard(service, e, "found"));
      case "get_schedule":
        return args.from && (!args.to || args.to === args.from) ? [dayCard(service, args.from, f.day(args.from))] : [];
      case "whats_now":
        return [dayCard(service, f.today, "today")];
      case "add_note":
      case "update_note":
      case "append_note":
        return result?.id ? [{ kind: "note", state: tool === "add_note" ? "added" : "changed", label: result.title || "Untitled", course: result.course_name || "" }] : [];
      case "set_settings":
        return [{ kind: "setting", label: "Settings", value: Object.entries(args).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(", ") }];
      case "set_home_zone":
        return [{ kind: "setting", label: "Time zone", value: service.tz }];
      case "set_ringtone":
        return [{ kind: "setting", label: "Ringtone", value: String(args.ringtone) }];
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/** Keep a message's cards short: the last few, without repeats. */
export function trimCards(cards) {
  const seen = new Set();
  const out = [];
  for (const c of [...cards].reverse()) {
    const key = JSON.stringify([c.kind, c.label, c.time, c.when, c.state]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.unshift(c);
  }
  return out.slice(-MAX_CARDS);
}

export { dayCard, eventCard, alarmCard };
