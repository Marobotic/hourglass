import { finishedTimer } from "../core/alarms.js";
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

export function createRingRoutes(t) {
  t.ringStops ??= new Map();
  t.ringWatchers ??= new Map();
  t.dismissedSnoozes ??= new Map(); // snooze timer id -> when the alarm was dismissed
  // applyPush runs this on every row a device pushes (see createHandler).
  t.ringGuard ??= (table, row) => {
    if (table !== "timers" || row.state !== "running" || row.deleted) return row;
    const dismissedAt = t.dismissedSnoozes.get(row.id);
    if (dismissedAt === undefined) return row;
    if (dismissedAt < Date.now() - STOP_TTL) { t.dismissedSnoozes.delete(row.id); return row; }
    return { ...row, ...finishedTimer(row) };
  };
  const keyOf = (id, at) => `${id}:${at}`;
  const state = (key) => {
    const hit = t.ringStops.get(key);
    if (!hit) return null;
    if (hit.ts < Date.now() - STOP_TTL) { t.ringStops.delete(key); return null; }
    return hit;
  };
  return async (req, res, url, path) => {
    const watchKey = keyOf(url.searchParams.get("alarm_id"), url.searchParams.get("at"));
    if (path === "/api/ring/state" || path === "/api/ring/watch") {
      if (req.method !== "GET") return false;
      if (!url.searchParams.get("alarm_id") || url.searchParams.get("at") === null || url.searchParams.get("at") === "" || !Number.isFinite(Number(url.searchParams.get("at")))) {
        res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "alarm_id and at are required" })); return true;
      }
      const stopped = state(watchKey);
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
      res.end(JSON.stringify({ stopped: state(watchKey) }));
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
    const at = Number(b.at);
    const stopped = { action: b.action, device: String(b.device || req.headers["x-hourglass-device"] || "unknown"), ts: Date.now() };
    const key = keyOf(String(b.alarm_id), at);
    t.ringStops.set(key, stopped);
    for (const [k, hit] of t.ringStops) if (hit.ts < Date.now() - STOP_TTL) t.ringStops.delete(k);
    t.store.upsert("prefs", { id: `ring_stop:${b.alarm_id}`, value: JSON.stringify({ at, ...stopped }) });
    if (b.action === "dismissed") {
      const snooze = snoozeId(b.alarm_id, at);
      t.dismissedSnoozes.set(snooze, Date.now());
      for (const [k, ts] of t.dismissedSnoozes) if (ts < Date.now() - STOP_TTL) t.dismissedSnoozes.delete(k);
      for (const id of new Set([snooze, String(b.alarm_id)])) {
        const timer = t.store.get("timers", id);
        if (timer && !timer.deleted && timer.state === "running") t.service.updateTimer({ timer_id: id, action: "done" });
      }
    }
    for (const wake of t.ringWatchers.get(key) ?? []) wake();
    t.ringWatchers.delete(key);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true }));
    return true;
  };
}
