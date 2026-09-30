#!/usr/bin/env node
// Hourglass Linux sidecar. Holds the local replica, serves the app and local
// AIs on 127.0.0.1, rings alarms and timers, and syncs with the server.
//   config: ~/.config/hourglass/config.json  { "server": "https://...", "token": "..." }
//   data:   ~/.local/share/hourglass/
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Store } from "../../core/node/store.js";
import { Service } from "../../core/node/service.js";
import { TABLE_NAMES, dueBetween, isSpent } from "../../core/index.js";
import { createHandler } from "../../server/app.js";

const HOME = homedir();
const CONF_DIR = process.env.HOURGLASS_CONFIG || join(HOME, ".config/hourglass");
const DATA_DIR = process.env.HOURGLASS_DATA || join(HOME, ".local/share/hourglass");
const PORT = Number(process.env.HOURGLASS_PORT || 8931);
const THEME = join(HOME, ".local/state/omarchy/current/theme/colors.toml");
const SOUND = "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga";
const SILENT = process.env.HOURGLASS_SILENT === "1"; // tests: no notification, no sound
mkdirSync(CONF_DIR, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function token() {
  const p = join(CONF_DIR, "token");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const t = randomBytes(24).toString("base64url");
  writeFileSync(p, t + "\n", { mode: 0o600 });
  return t;
}

const config = () => {
  try {
    return JSON.parse(readFileSync(join(CONF_DIR, "config.json"), "utf8"));
  } catch {
    return {};
  }
};

const store = new Store(join(DATA_DIR, "hourglass.db"), { replica: true });
const service = new Service(store);
const TOKEN = token();

// --- theme ---------------------------------------------------------------------

const FALLBACK = { background: "#121212", foreground: "#f5f5f5", accent: "#B14242", color1: "#D66E36", color3: "#F0BE66", color4: "#4A8B8B", color8: "#949494" };
function theme() {
  const t = { ...FALLBACK };
  try {
    for (const line of readFileSync(THEME, "utf8").split("\n")) {
      const m = line.match(/^\s*([a-z0-9_]+)\s*=\s*"(#[0-9a-fA-F]{6})"/);
      if (m) t[m[1]] = m[2];
    }
  } catch {}
  return t;
}

// --- sync ------------------------------------------------------------------------

const sync = { state: "local", last_ok: null, error: null, pending: 0 };

async function syncOnce() {
  const { server, token: remoteToken } = config();
  const dirty = store.dirtyRows();
  sync.pending = TABLE_NAMES.reduce((n, t) => n + dirty[t].length, 0);
  if (!server) {
    sync.state = "local";
    return;
  }
  const headers = { authorization: `Bearer ${remoteToken}`, "content-type": "application/json" };
  try {
    if (sync.pending) {
      const body = { changes: Object.fromEntries(TABLE_NAMES.map((t) => [t, dirty[t].map((r) => ({ ...r, base_rev: r.rev }))])) };
      const r = await fetch(`${server}/api/sync`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`push ${r.status}`);
      for (const t of TABLE_NAMES) for (const row of dirty[t]) store.clearDirty(t, row.id, row.updated_at);
    }
    const since = store.meta("cursor", 0);
    const r = await fetch(`${server}/api/sync?since=${since}`, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`pull ${r.status}`);
    const { rev, changes } = await r.json();
    for (const t of TABLE_NAMES) for (const row of changes[t] ?? []) store.write(t, row, { mode: "remote" });
    store.setMeta("cursor", rev);
    Object.assign(sync, { state: "synced", last_ok: Date.now(), error: null, pending: 0 });
  } catch (e) {
    Object.assign(sync, { state: "offline", error: e.message });
  }
}

let syncTimer = null;
const scheduleSync = (ms = 1500) => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncOnce, ms);
};
store.onChange((_, row) => row.dirty && scheduleSync());
setInterval(() => scheduleSync(0), 30000);

// --- alarms & timers ------------------------------------------------------------------

const ringing = new Map(); // id -> { kind, id, label, at, sound }
let lastCheck = Date.now();

function notify(item) {
  if (SILENT) return;
  const title = item.kind === "timer" ? "Timer done" : "Alarm";
  const n = spawn("notify-send", ["-a", "Hourglass", "-u", "critical", "-i", "alarm-symbolic", "-h", "string:x-canonical-private-synchronous:hourglass-" + item.id, title, item.label], { stdio: "ignore" });
  n.on("error", () => {});
}

function playLoop(item) {
  if (SILENT) return () => {};
  let stopped = false;
  let child = null;
  const until = Date.now() + 60000;
  const once = () => {
    if (stopped || Date.now() > until) return ring_stop(item.id);
    child = spawn("pw-play", [SOUND], { stdio: "ignore" });
    child.on("error", () => {});
    child.on("exit", () => setTimeout(once, 400));
  };
  once();
  return () => {
    stopped = true;
    child?.kill();
  };
}

function ring(item) {
  if (ringing.has(item.id)) return;
  log("ring", item.kind, item.label);
  notify(item);
  ringing.set(item.id, { ...item, stop: playLoop(item) });
  const data = service.data();
  if (item.kind === "timer") service.updateTimer({ timer_id: item.id, action: "done" });
  if (item.kind === "alarm") {
    const a = data.alarms.find((x) => x.id === item.id);
    if (a && isSpent(a, data, Date.now() + 1000, service.tz)) store.upsert("alarms", { id: a.id, enabled: 0 });
  }
}

function ring_stop(id) {
  const r = ringing.get(id);
  if (!r) return false;
  r.stop();
  ringing.delete(id);
  return true;
}

setInterval(() => {
  const now = Date.now();
  // a suspended laptop can skip ahead; ring what fell due, but not stale items older than 10 min
  const from = Math.max(lastCheck, now - 10 * 60000);
  for (const item of dueBetween(service.data(), from, now, service.tz)) ring(item);
  lastCheck = now;
}, 1000);

// --- HTTP ------------------------------------------------------------------------

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

async function extra(req, res, url, path) {
  if (path === "/api/app" && req.method === "GET") {
    return json(res, 200, {
      theme: theme(),
      sync: { ...sync, server: config().server ?? null },
      ringing: [...ringing.values()].map(({ stop, ...r }) => r),
      settings: service.settings(),
    }), true;
  }
  if (path === "/api/ring/stop" && req.method === "POST") {
    const id = url.searchParams.get("id");
    const ids = id ? [id] : [...ringing.keys()];
    return json(res, 200, { stopped: ids.filter(ring_stop) }), true;
  }
  if (path === "/api/ring/snooze" && req.method === "POST") {
    const id = url.searchParams.get("id");
    const r = ringing.get(id);
    if (!r) return json(res, 404, { error: "not ringing" }), true;
    ring_stop(id);
    const t = service.startTimer({ minutes: Number(url.searchParams.get("minutes") || 5), label: `${r.label} (snoozed)` });
    return json(res, 200, t), true;
  }
  if (path === "/api/sync/now" && req.method === "POST") {
    await syncOnce();
    return json(res, 200, sync), true;
  }
  return false;
}

const handler = createHandler({ store, service, token: TOKEN, extra });
createServer(handler).listen(PORT, "127.0.0.1", () => {
  log(`hourglassd on http://127.0.0.1:${PORT} (data ${DATA_DIR}, tz ${service.tz})`);
  scheduleSync(0);
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => {
  for (const id of [...ringing.keys()]) ring_stop(id);
  process.exit(0);
});
