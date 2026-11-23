import { finishedTimer, nextAlarmTime, parseRingStop, ringStopKey, ringStopped } from "../core/alarms.js";
import { snoozeTimerId } from "../core/ring.js";

const STOP_TTL = 24 * 60 * 60_000;
const WAIT_MS = 25_000;

// A dismissed alarm occurrence never rings again, so the snooze timer it would
// have made must never run either: the id is fixed by the alarm and the
// occurrence (see snoozeTimerId), which lets the server cancel it before the
// row even exists. A device that was offline, or one that auto-snoozed and
// synced late, used to bring a dismissed alarm back 5 minutes later.
export function snoozeId(alarmId, at) {
  return snoozeTimerId(alarmId, at);
}

// What /api/ring/state and /watch report: everything but the occurrence.
const publicStop = ({ at, ...rest }) => rest;

export function createRingRoutes(t) {
  t.ringStops ??= new Map();
  t.ringWatchers ??= new Map();
  t.dismissedSnoozes ??= new Map(); // snooze timer id -> when the alarm was dismissed
  const keyOf = (id, at) => `${id}:${at}`;
  const storedStop = (id) => parseRingStop(t.store.get("prefs", ringStopKey(id))?.value);
  const ended = (stop) => stop && stop.action !== "snoozed";

  // Why a ring must not go on, or null. In memory first (what devices posted to
  // /api/ring/stop), then what survives a restart and what came by sync or from
  // the assistant: the synced ring_stop pref (a skip is one), and the alarm row
  // itself (deleted, or turned off). On 2026-11-23 the assistant turned an
  // alarm off; the iPhone, not synced yet, rang it anyway, and its Snooze was
  // accepted because this said "not stopped": the snooze timer then rang on the
  // iPhone and on Windows five minutes later.
  const state = (id, at) => {
    const hit = t.ringStops.get(keyOf(id, at));
    if (hit && hit.ts >= Date.now() - STOP_TTL) return hit;
    if (hit) t.ringStops.delete(keyOf(id, at));
    const stop = ringStopped(t.store.get("alarms", id), storedStop(id), Number(at));
    return stop ? publicStop(stop) : null;
  };

  // Snooze timers that must never run: those of an occurrence that was
  // dismissed or skipped (kept in the synced pref, so a restart does not forget
  // it), and those of an alarm that is deleted or turned off.
  const blockedSnooze = (timerId) => {
    const dismissedAt = t.dismissedSnoozes.get(timerId);
    if (dismissedAt !== undefined) {
      if (dismissedAt >= Date.now() - STOP_TTL) return true;
      t.dismissedSnoozes.delete(timerId);
    }
    // Occurrences are compared on the service clock (the one alarms ring on).
    const now = t.service?.clock?.() ?? Date.now();
    for (const p of t.store.all("prefs")) {
      if (!p.id.startsWith("ring_stop:")) continue;
      const stop = parseRingStop(p.value);
      if (ended(stop) && stop.at > now - STOP_TTL && snoozeTimerId(p.id.slice("ring_stop:".length), stop.at) === timerId) return true;
    }
    let data = null;
    for (const a of t.store.all("alarms", { withDeleted: true })) {
      if (!ringStopped(a, null, 0)) continue;
      // Deleted or off: none of its rings of the last day may come back.
      data ??= { events: t.store.all("events"), courses: t.store.all("courses") };
      const live = { ...a, deleted: 0, enabled: 1 };
      for (let at = nextAlarmTime(live, data, now - STOP_TTL, t.service.tz), n = 0; at !== null && at <= now + 60_000 && n < 50; at = nextAlarmTime(live, data, at, t.service.tz), n++) {
        if (snoozeTimerId(a.id, at) === timerId) return true;
      }
    }
    return false;
  };

  // applyPush runs this on every row a device pushes (see createHandler).
  t.ringGuard ??= (table, row) => {
    if (table === "timers") {
      if (row.state !== "running" || row.deleted) return row;
      // One tick newer than what the device sent, so its own copy loses to
      // this one on the next pull (every app keeps the newer updated_at).
      return blockedSnooze(row.id) ? { ...row, ...finishedTimer(row), updated_at: (Number(row.updated_at) || 0) + 1 } : row;
    }
    if (table === "prefs" && typeof row.id === "string" && row.id.startsWith("ring_stop:") && !row.deleted) {
      // A dismissal or a skip is final for its occurrence: a late "snoozed" for
      // the same ring, or one for an alarm that is off, does not undo it.
      const id = row.id.slice("ring_stop:".length);
      const sent = parseRingStop(row.value);
      if (!sent || sent.action !== "snoozed") return row;
      const existingRow = t.store.get("prefs", row.id);
      const existing = parseRingStop(existingRow?.value);
      const stop = ended(existing) && existing.at === sent.at ? existing : ringStopped(t.store.get("alarms", id), null, sent.at);
      if (!stop) return row;
      return { ...row, value: JSON.stringify({ ...stop, ts: stop.ts ?? Date.now() }), updated_at: Math.max(Number(row.updated_at) || 0, (existingRow?.updated_at ?? 0) + 1) };
    }
    return row;
  };

  const wake = (key) => {
    for (const fn of t.ringWatchers.get(key) ?? []) fn();
    t.ringWatchers.delete(key);
  };
  // A stop that arrives by sync or from the assistant (a skip, an alarm turned
  // off or deleted) ends a waiting /watch at once, like a POST to /stop does.
  if (!t.ringWatchHook) {
    t.ringWatchHook = true;
    t.store.onChange?.((table, row) => {
      if (!t.ringWatchers.size) return;
      if (table === "prefs" && row.id?.startsWith("ring_stop:")) {
        const stop = parseRingStop(row.value);
        if (stop) wake(keyOf(row.id.slice("ring_stop:".length), stop.at));
      } else if (table === "alarms" && ringStopped(row, null, 0)) {
        for (const key of [...t.ringWatchers.keys()]) if (key.startsWith(`${row.id}:`)) wake(key);
      }
    });
  }

  // Ends a snooze timer that must not run (it may already exist on the server).
  const endSnooze = (alarmId, at) => {
    const snooze = snoozeId(alarmId, at);
    t.dismissedSnoozes.set(snooze, Date.now());
    for (const [k, ts] of t.dismissedSnoozes) if (ts < Date.now() - STOP_TTL) t.dismissedSnoozes.delete(k);
    for (const id of new Set([snooze, String(alarmId)])) {
      const timer = t.store.get("timers", id);
      if (timer && !timer.deleted && timer.state === "running") t.service.updateTimer({ timer_id: id, action: "done" });
    }
  };

  return async (req, res, url, path) => {
    const qId = url.searchParams.get("alarm_id");
    const qAt = url.searchParams.get("at");
    if (path === "/api/ring/state" || path === "/api/ring/watch") {
      if (req.method !== "GET") return false;
      if (!qId || qAt === null || qAt === "" || !Number.isFinite(Number(qAt))) {
        res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "alarm_id and at are required" })); return true;
      }
      const watchKey = keyOf(qId, Number(qAt));
      const stopped = state(qId, Number(qAt));
      if (stopped || path.endsWith("/state")) {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return res.end(JSON.stringify({ stopped })), true;
      }
      await new Promise((resolve) => {
        const watcher = () => { clearTimeout(timer); resolve(); };
        let list = t.ringWatchers.get(watchKey);
        if (!list) t.ringWatchers.set(watchKey, list = new Set());
        list.add(watcher);
        const timer = setTimeout(() => { list.delete(watcher); if (!list.size) t.ringWatchers.delete(watchKey); resolve(); }, WAIT_MS);
        res.on("close", watcher);
      });
      if (res.destroyed) return true;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ stopped: state(qId, Number(qAt)) }));
      return true;
    }
    if (path !== "/api/ring/stop" || req.method !== "POST") return false;
    let body = "";
    for await (const chunk of req) body += chunk;
    let b;
    try { b = JSON.parse(body || "{}"); } catch { b = {}; }
    if (!b.alarm_id || !Number.isFinite(Number(b.at)) || !["dismissed", "snoozed"].includes(b.action)) {
      res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "alarm_id, at and a valid action are required" })); return true;
    }
    const alarmId = String(b.alarm_id);
    const at = Number(b.at);
    const key = keyOf(alarmId, at);
    const device = String(b.device || req.headers["x-hourglass-device"] || "unknown");
    if (b.action === "snoozed") {
      // A snooze of a ring that was already dismissed or skipped, or of an
      // alarm that is off or deleted, does not bring it back: it ends it.
      const prior = t.ringStops.get(key);
      const stored = storedStop(alarmId);
      const final = ended(prior) ? { at, ...prior } : ringStopped(t.store.get("alarms", alarmId), ended(stored) ? stored : null, at);
      if (final) {
        if (!ended(stored) || stored.at !== at) t.store.upsert("prefs", { id: ringStopKey(alarmId), value: JSON.stringify({ ...final, at, ts: final.ts ?? Date.now() }) });
        t.ringStops.set(key, { ...publicStop(final), ts: final.ts ?? Date.now() });
        endSnooze(alarmId, at);
        wake(key);
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, snoozed: false, stopped: publicStop(final) }));
        return true;
      }
    }
    const stopped = { action: b.action, device, ts: Date.now() };
    t.ringStops.set(key, stopped);
    for (const [k, hit] of t.ringStops) if (hit.ts < Date.now() - STOP_TTL) t.ringStops.delete(k);
    t.store.upsert("prefs", { id: ringStopKey(alarmId), value: JSON.stringify({ at, ...stopped }) });
    if (b.action === "dismissed") endSnooze(alarmId, at);
    wake(key);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true }));
    return true;
  };
}
